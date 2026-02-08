import { randomUUID } from "node:crypto";
import type { NatsAction, NatsActionType } from "@/core/nats-actions";
import { actionKeywords } from "@/core/nats-actions";

const RANDOM_ID_PATTERN = /randomId\(\)/gi;
const COMMENT_PATTERN = /^\s*(?:#|\/\/)/;
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

export function parseNatsDocument(
  text: string,
  globalVariables: Record<string, string> = {},
): NatsAction[] {
  const segments = segmentNatsDocument(text);
  const actions: NatsAction[] = [];
  const localVariables: Record<string, string> = {};

  for (const segment of segments) {
    if (segment.kind !== "block") {
      continue;
    }

    // First pass: collect local variables
    for (const line of segment.lines) {
      const trimmed = line.text.trim();
      if (trimmed.startsWith("@")) {
        const parts = trimmed.split("=");
        if (parts.length === 2) {
          const key = parts[0].trim().substring(1); // Remove @
          const value = parts[1].trim();
          localVariables[key] = value;
        }
      }
    }

    const mergedVariables = { ...globalVariables, ...localVariables };
    const action = parseActionFromBlock(segment.lines, mergedVariables);
    if (action) {
      actions.push(action);
    }
  }

  return actions;
}

function resolveVariables(
  text: string,
  variables: Record<string, string>,
): string {
  return text.replaceAll(/\{\{([\w.-]+)\}\}/g, (match, key) => {
    const trimmedKey = key.trim();
    if (trimmedKey.startsWith("env:")) {
      const envName = trimmedKey.slice(4);
      return process.env[envName] ?? match;
    }
    return variables[trimmedKey] ?? match;
  });
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
    if (raw.trimStart().startsWith("###")) {
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

function createJetStreamPublishAction(
  lineNumber: number,
  connection: { server: string; subject?: string },
  meta: Map<string, string>,
  body: string | undefined,
  headers: Record<string, string> | undefined,
  timeoutMs: number | undefined,
): NatsAction {
  const stream = meta.get("nats-stream");
  return {
    type: "jetstreamPublish",
    lineNumber,
    subject: connection.subject ?? "",
    server: connection.server,
    stream: stream,
    data: body,
    headers,
    timeoutMs,
  };
}

function createJetStreamConsumeAction(
  lineNumber: number,
  connection: { server: string; subject?: string },
  meta: Map<string, string>,
  headers: Record<string, string> | undefined,
): NatsAction | undefined {
  const stream = meta.get("nats-stream");
  const durable = meta.get("nats-durable");

  if (stream && durable) {
    return {
      type: "jetstreamConsume",
      lineNumber,
      subject: "",
      server: connection.server,
      stream,
      durable,
      headers,
    };
  }

  const pathParts = connection.subject?.split("/") ?? [];
  if (pathParts.length === 2) {
    return {
      type: "jetstreamConsume",
      lineNumber,
      subject: "",
      server: connection.server,
      stream: pathParts[0],
      durable: pathParts[1],
      headers,
    };
  }

  return undefined;
}

function createReplyAction(
  lineNumber: number,
  connection: { server: string; subject?: string },
  meta: Map<string, string>,
  body: string | undefined,
  headers: Record<string, string> | undefined,
): NatsAction {
  const replyMode = (meta.get("nats-reply-mode") ?? "").toLowerCase();
  const templateMode =
    replyMode === "template" || (!replyMode && !looksLikeJson(body));
  return {
    type: "reply",
    lineNumber,
    subject: connection.subject!,
    server: connection.server,
    template: templateMode ? body : undefined,
    data: templateMode ? undefined : body,
    headers,
  };
}

function parseActionFromBlock(
  lines: RawLine[],
  variables: Record<string, string>,
): NatsAction | undefined {
  if (lines.length === 0) {
    return undefined;
  }

  const requestIndex = findRequestLineIndex(lines);
  if (requestIndex === -1) {
    return undefined;
  }

  const rawRequestLine = lines[requestIndex].text.trim();
  const requestLine = resolveVariables(rawRequestLine, variables);

  const [keyword] = requestLine.split(/\s+/, 1);
  const type = mapKeyword(keyword);
  if (!type) {
    return undefined;
  }

  const target = requestLine.slice(keyword.length).trim();
  const headerResult = parseHeaders(lines, requestIndex + 1, variables);
  const { headers, meta } = partitionHeaders(headerResult.headers);
  const body = collectBody(lines, headerResult.nextIndex, variables);
  const connection = resolveConnection(target, meta);
  if (!connection) {
    return undefined;
  }

  const timeoutMs = parseInteger(meta.get("nats-timeout"));
  const { lineNumber } = lines[requestIndex];

  if (type === "jetstreamPublish") {
    return createJetStreamPublishAction(
      lineNumber,
      connection,
      meta,
      body,
      headers,
      timeoutMs,
    );
  }

  if (type === "jetstreamConsume") {
    return createJetStreamConsumeAction(lineNumber, connection, meta, headers);
  }

  if (!connection.subject) {
    return undefined;
  }

  if (type === "reply") {
    return createReplyAction(lineNumber, connection, meta, body, headers);
  }

  const action: NatsAction = {
    type,
    lineNumber,
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
  variables: Record<string, string>,
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
    const resolvedValue = resolveVariables(value, variables);
    headers.push({ key, value: sanitizeRandomIds(resolvedValue) });
    index += 1;
  }
  return { headers, nextIndex: index };
}

function collectBody(
  lines: RawLine[],
  startIndex: number,
  variables: Record<string, string>,
): string | undefined {
  if (startIndex >= lines.length) {
    return undefined;
  }
  const bodyLines = lines.slice(startIndex).map((line) => line.text);
  while (bodyLines.length > 0 && bodyLines[0].trim().length === 0) {
    bodyLines.shift();
  }
  while (bodyLines.length > 0 && bodyLines.at(-1)!.trim().length === 0) {
    bodyLines.pop();
  }
  if (bodyLines.length === 0) {
    return undefined;
  }
  return sanitizeRandomIds(resolveVariables(bodyLines.join("\n"), variables));
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
    // Subject is optional for some commands
    return { subject, server };
  }

  const serverHeader = meta.get("nats-server");
  if (!serverHeader) {
    return undefined;
  }
  const subject = candidateSubject || meta.get("nats-subject");
  // Subject is optional for some commands
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
  const { username, password, port, protocol, hostname } = url;

  let auth = "";
  if (username) {
    const userPass = password ? `${username}:${password}` : username;
    auth = `${userPass}@`;
  }

  const portStr = port ? `:${port}` : "";
  return `${protocol}//${auth}${hostname}${portStr}`;
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

    case actionKeywords.jetstreamPublish:
      return "jetstreamPublish";
    case actionKeywords.jetstreamConsume:
      return "jetstreamConsume";
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
  return value.replaceAll(RANDOM_ID_PATTERN, () => `"${randomUUID()}"`);
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
