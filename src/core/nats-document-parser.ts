import { randomUUID } from "crypto";
import {
  NatsAction,
  NatsActionType,
  actionKeywords,
} from "@/core/nats-actions";

const RANDOM_ID_PATTERN = /randomId\(\)/gi;
const BLOCK_DELIMITER = /^\s*#{3,}\s*$/;
const COMMENT_PATTERN = /^\s*(#|\/\/)/;
const META_HEADERS = new Set([
  "nats-server",
  "nats-timeout",
  "nats-stream",
  "nats-durable",
  "nats-batch",
  "nats-reply-mode",
  "nats-subject",
]);
const SUPPORTED_PROTOCOLS = new Set(["nats:", "tls:", "ws:", "wss:"]);
const HEADER_KEY_PATTERN = /^[A-Za-z0-9-]+$/;

export interface RawLine {
  readonly text: string;
  readonly lineNumber: number;
}

export type NatsDocumentSegment =
  | { kind: "delimiter"; line: RawLine }
  | { kind: "block"; lines: RawLine[] };

export function parseNatsDocument(text: string): NatsAction[] {
  const segments = segmentNatsDocument(text);
  const actions: NatsAction[] = [];

  for (const segment of segments) {
    if (segment.kind !== "block") {
      continue;
    }
    const action = parseActionFromBlock(segment.lines);
    if (action) {
      actions.push(action);
    }
  }

  return actions;
}

export function findActionNearestLine(
  actions: readonly NatsAction[],
  line: number,
  type?: NatsActionType,
): NatsAction | undefined {
  return actions.find(
    (action) => action.lineNumber === line && (!type || action.type === type),
  );
}

export function segmentNatsDocument(text: string): NatsDocumentSegment[] {
  const lines = text.split(/\r?\n/);
  const segments: NatsDocumentSegment[] = [];
  let current: RawLine[] = [];

  const flushBlock = (): void => {
    if (current.length > 0) {
      segments.push({ kind: "block", lines: current });
      current = [];
    }
  };

  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index];
    if (BLOCK_DELIMITER.test(raw)) {
      flushBlock();
      segments.push({
        kind: "delimiter",
        line: { text: raw, lineNumber: index },
      });
      continue;
    }
    current.push({ text: raw, lineNumber: index });
  }

  flushBlock();

  if (segments.length === 0) {
    segments.push({ kind: "block", lines: [] });
  }

  return segments;
}

function parseActionFromBlock(lines: RawLine[]): NatsAction | undefined {
  if (lines.length === 0) {
    return undefined;
  }

  const requestIndex = findRequestLineIndex(lines);
  if (requestIndex === -1) {
    return undefined;
  }

  const requestLine = lines[requestIndex].text.trim();
  const [keyword] = requestLine.split(/\s+/, 1);
  const type = mapKeyword(keyword);
  if (!type) {
    return undefined;
  }

  const target = requestLine.slice(keyword.length).trim();
  const headerResult = parseHeaders(lines, requestIndex + 1);
  const { headers, meta } = partitionHeaders(headerResult.headers);
  const body = collectBody(lines, headerResult.nextIndex);
  const connection = resolveConnection(target, meta);
  if (!connection) {
    return undefined;
  }

  const timeoutMs = parseInteger(meta.get("nats-timeout"));
  if (type === "jetstreamPull") {
    if (!meta.get("nats-stream") || !meta.get("nats-durable")) {
      return undefined;
    }
    const batchCandidate = parseInteger(meta.get("nats-batch")) ?? 1;
    return {
      type,
      lineNumber: lines[requestIndex].lineNumber,
      subject: meta.get("nats-stream") ?? "",
      server: connection.server,
      stream: meta.get("nats-stream") ?? undefined,
      durable: meta.get("nats-durable") ?? undefined,
      batchSize: Math.max(1, batchCandidate),
      timeoutMs: timeoutMs,
      headers: headers,
    };
  }

  if (!connection.subject) {
    return undefined;
  }

  if (type === "reply") {
    const replyMode = (meta.get("nats-reply-mode") ?? "").toLowerCase();
    const templateMode =
      replyMode === "template" || (!replyMode && !looksLikeJson(body));
    return {
      type,
      lineNumber: lines[requestIndex].lineNumber,
      subject: connection.subject,
      server: connection.server,
      template: templateMode ? body : undefined,
      data: !templateMode ? body : undefined,
      headers,
    };
  }

  const action: NatsAction = {
    type,
    lineNumber: lines[requestIndex].lineNumber,
    subject: connection.subject,
    server: connection.server,
    data: body,
    headers,
    timeoutMs,
  };

  return action;
}

function findRequestLineIndex(lines: RawLine[]): number {
  for (let index = 0; index < lines.length; index++) {
    const trimmed = lines[index].text.trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (COMMENT_PATTERN.test(trimmed) || trimmed.startsWith("@")) {
      continue;
    }
    if (mapKeyword(trimmed.split(/\s+/, 1)[0] ?? "")) {
      return index;
    }
    break;
  }
  return -1;
}

function parseHeaders(
  lines: RawLine[],
  startIndex: number,
): { headers: HeaderEntry[]; nextIndex: number } {
  const headers: HeaderEntry[] = [];
  let index = startIndex;
  while (index < lines.length) {
    const raw = lines[index].text;
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      index += 1;
      break;
    }
    if (COMMENT_PATTERN.test(trimmed)) {
      index += 1;
      continue;
    }
    const separator = raw.indexOf(":");
    if (separator === -1) {
      break;
    }
    const key = raw.slice(0, separator).trim();
    if (!HEADER_KEY_PATTERN.test(key)) {
      break;
    }
    const value = raw.slice(separator + 1).trim();
    headers.push({ key, value: sanitizeRandomIds(value) });
    index += 1;
  }
  return { headers, nextIndex: index };
}

function collectBody(lines: RawLine[], startIndex: number): string | undefined {
  if (startIndex >= lines.length) {
    return undefined;
  }
  const bodyLines = lines.slice(startIndex).map((line) => line.text);
  while (bodyLines.length > 0 && bodyLines[0].trim().length === 0) {
    bodyLines.shift();
  }
  while (
    bodyLines.length > 0 &&
    bodyLines[bodyLines.length - 1].trim().length === 0
  ) {
    bodyLines.pop();
  }
  if (bodyLines.length === 0) {
    return undefined;
  }
  return sanitizeRandomIds(bodyLines.join("\n"));
}

function resolveConnection(
  target: string,
  meta: Map<string, string>,
): { subject?: string; server: string } | undefined {
  const trimmedTarget = target.trim();
  const candidateSubject =
    trimmedTarget.length > 0 ? trimmedTarget : (meta.get("nats-subject") ?? "");
  const url = tryParseUrl(candidateSubject);
  if (url) {
    const server = buildServerUrl(url);
    const subject = decodeSubject(url.pathname) ?? meta.get("nats-subject");
    if (!subject) {
      return undefined;
    }
    return { subject, server };
  }

  const serverHeader = meta.get("nats-server");
  if (!serverHeader) {
    return undefined;
  }
  const subject = candidateSubject || meta.get("nats-subject");
  if (!subject) {
    return undefined;
  }
  return { subject, server: serverHeader };
}

function tryParseUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    if (!SUPPORTED_PROTOCOLS.has(url.protocol)) {
      return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
}

function buildServerUrl(url: URL): string {
  const auth = url.username
    ? `${url.username}${url.password ? `:${url.password}` : ""}@`
    : "";
  const port = url.port ? `:${url.port}` : "";
  return `${url.protocol}//${auth}${url.hostname}${port}`;
}

function decodeSubject(pathname: string): string | undefined {
  const trimmed = pathname.startsWith("/") ? pathname.slice(1) : pathname;
  const decoded = decodeURIComponent(trimmed);
  return decoded.length > 0 ? decoded : undefined;
}

function partitionHeaders(entries: HeaderEntry[]): {
  headers?: Record<string, string>;
  meta: Map<string, string>;
} {
  if (entries.length === 0) {
    return { meta: new Map() };
  }
  const headers: Record<string, string> = {};
  const meta = new Map<string, string>();
  for (const entry of entries) {
    const lower = entry.key.toLowerCase();
    if (META_HEADERS.has(lower)) {
      meta.set(lower, entry.value);
      continue;
    }
    headers[entry.key] = entry.value;
  }
  return { headers: Object.keys(headers).length ? headers : undefined, meta };
}

function mapKeyword(keyword: string): NatsActionType | undefined {
  const upper = keyword.toUpperCase();
  switch (upper) {
    case actionKeywords.subscribe:
      return "subscribe";
    case actionKeywords.request:
      return "request";
    case actionKeywords.publish:
      return "publish";
    case actionKeywords.reply:
      return "reply";
    case actionKeywords.jetstreamPull:
      return "jetstreamPull";
    default:
      return undefined;
  }
}

function looksLikeJson(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const trimmed = value.trim();
  return (
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    trimmed.startsWith('"') ||
    trimmed.startsWith("'")
  );
}

function sanitizeRandomIds(value: string): string {
  return value.replace(RANDOM_ID_PATTERN, () => `"${randomUUID()}"`);
}

function parseInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const numeric = Number.parseInt(value, 10);
  return Number.isFinite(numeric) ? numeric : undefined;
}

interface HeaderEntry {
  key: string;
  value: string;
}
