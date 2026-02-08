import * as vscode from "vscode";
import type { RawLine, NatsDocumentSegment } from "@/core/nats-document-parser";
import { segmentNatsDocument } from "@/core/nats-document-parser";

const FILE_GLOB = "**/*.nats";
const JSON_CANDIDATE = /^[\[{]/;
const HEADER_KEY_PATTERN = /^[A-Za-z0-9-]+$/;
const COMMENT_PATTERN = /^\s*(#|\/\/)/;

export function registerFormattingProvider(
  context: vscode.ExtensionContext,
): void {
  const provider = new NatsFormattingProvider();
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider(
      { pattern: FILE_GLOB, language: "nats" },
      provider,
    ),
  );
}

class NatsFormattingProvider implements vscode.DocumentFormattingEditProvider {
  provideDocumentFormattingEdits(
    document: vscode.TextDocument,
  ): vscode.TextEdit[] {
    const formatter = new NatsFormatter();
    const formatted = formatter.format(document.getText());
    if (formatted === document.getText()) {
      return [];
    }
    const lastLine = document.lineCount > 0 ? document.lineCount - 1 : 0;
    const lastLineLength = document.lineAt(lastLine).text.length;
    const range = new vscode.Range(0, 0, lastLine, lastLineLength);
    return [vscode.TextEdit.replace(range, formatted)];
  }
}

export class NatsFormatter {
  private static readonly headerlessBodyVerbs = new Set(["REPLY", "PUBLISH"]);

  private pushLine(lines: string[], value: string): void {
    if (value.length === 0) {
      if (lines.length === 0 || lines[lines.length - 1].length === 0) {
        return;
      }
    }
    lines.push(value);
  }

  private processSegment(lines: string[], segment: NatsDocumentSegment): void {
    if (segment.kind === "delimiter") {
      if (lines.length > 0 && lines[lines.length - 1].length !== 0) {
        lines.push("");
      }
      lines.push(segment.line.text.trim());
      lines.push("");
      return;
    }
    if (segment.lines.length === 0) {
      return;
    }
    const block = this.formatBlock(segment.lines);
    if (block.length === 0) {
      return;
    }
    if (lines.length > 0 && lines[lines.length - 1].length !== 0) {
      lines.push("");
    }
    for (const line of block) {
      this.pushLine(lines, line);
    }
  }

  format(text: string): string {
    const segments = segmentNatsDocument(text);
    const lines: string[] = [];

    for (const segment of segments) {
      this.processSegment(lines, segment);
    }

    while (lines.length > 0 && lines[lines.length - 1].length === 0) {
      lines.pop();
    }

    const output = lines.join("\n");
    const hadTrailingNewline = text.endsWith("\n");
    return hadTrailingNewline ? `${output}\n` : output;
  }

  private formatBlock(lines: RawLine[]): string[] {
    const requestIndex = this.findRequestLineIndex(lines);
    if (requestIndex === -1) {
      return lines.map((line) => line.text.trimEnd());
    }

    const before = lines.slice(0, requestIndex).map((l) => l.text.trimEnd());
    const requestLineStr = lines[requestIndex].text;
    const verb = this.extractVerb(requestLineStr);
    const formattedRequestLine = this.formatRequestLine(requestLineStr);

    let scanIndex = requestIndex + 1;
    let preserveLeadingBlankCount = 0;
    while (
      scanIndex < lines.length &&
      lines[scanIndex].text.trim().length === 0
    ) {
      preserveLeadingBlankCount++;
      scanIndex++;
    }

    const { headerLines, nextIndex } = this.extractHeaders(lines, scanIndex);
    const bodyLines = this.formatBody(lines.slice(nextIndex));

    const output: string[] = [];
    this.appendPrefixLines(output, before);
    output.push(formattedRequestLine);
    output.push(...headerLines);

    this.appendBodyWithPadding(
      output,
      bodyLines,
      headerLines,
      preserveLeadingBlankCount,
      verb,
    );

    return output;
  }

  private appendPrefixLines(output: string[], lines: string[]): void {
    for (const line of lines) {
      if (line.trim().length === 0) {
        if (output.length === 0 || output[output.length - 1].length === 0) {
          continue;
        }
        output.push("");
        continue;
      }
      output.push(line);
    }
  }

  private appendBodyWithPadding(
    output: string[],
    bodyLines: string[],
    headerLines: string[],
    preserveLeadingBlankCount: number,
    verb: string | undefined,
  ): void {
    if (preserveLeadingBlankCount > 0 && headerLines.length === 0) {
      for (let i = 0; i < preserveLeadingBlankCount; i++) {
        output.push("");
      }
    } else if (
      bodyLines.length > 0 &&
      (headerLines.length > 0 || this.shouldPadHeaderlessBody(verb))
    ) {
      output.push("");
    }
    output.push(...bodyLines);
  }

  private extractVerb(line: string): string | undefined {
    const trimmed = line.trim();
    if (!trimmed) {
      return undefined;
    }
    const [keyword] = trimmed.split(/\s+/, 1);
    return keyword?.toUpperCase();
  }

  private shouldPadHeaderlessBody(verb?: string): boolean {
    if (!verb) {
      return false;
    }
    return NatsFormatter.headerlessBodyVerbs.has(verb);
  }

  private findRequestLineIndex(lines: RawLine[]): number {
    for (let index = 0; index < lines.length; index++) {
      const trimmed = lines[index].text.trim();
      if (trimmed.length === 0) {
        continue;
      }
      if (COMMENT_PATTERN.test(trimmed) || trimmed.startsWith("@")) {
        continue;
      }
      const upper = trimmed.split(/\s+/, 1)[0]?.toUpperCase();
      if (
        upper &&
        [
          "SUBSCRIBE",
          "REQUEST",
          "PUBLISH",
          "REPLY",
          "JSPUBLISH",
          "JSCONSUME",
        ].includes(upper)
      ) {
        return index;
      }
      break;
    }
    return -1;
  }

  private formatRequestLine(line: string): string {
    const trimmed = line.trim();
    if (!trimmed) {
      return "";
    }
    const [keyword, ...rest] = trimmed.split(/\s+/);
    const upper = keyword.toUpperCase();
    const target = rest.join(" ").trim();
    return target.length > 0 ? `${upper} ${target}` : upper;
  }

  private extractHeaders(
    lines: RawLine[],
    startIndex: number,
  ): { headerLines: string[]; nextIndex: number } {
    const headers: string[] = [];
    let index = startIndex;
    while (index < lines.length) {
      const raw = lines[index].text;
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        index += 1;
        break;
      }
      if (COMMENT_PATTERN.test(trimmed)) {
        headers.push(trimmed);
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
      headers.push(`${key}: ${value}`);
      index += 1;
    }
    return { headerLines: headers, nextIndex: index };
  }

  private formatBody(lines: RawLine[]): string[] {
    if (lines.length === 0) {
      return [];
    }
    const bodyLines = lines.map((line) => line.text);
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
      return [];
    }
    const body = bodyLines.join("\n");
    if (!JSON_CANDIDATE.test(body.trim())) {
      return bodyLines.map((line) => line.trimEnd());
    }
    try {
      const parsed = JSON.parse(body);
      return JSON.stringify(parsed, null, 2).split("\n");
    } catch {
      return bodyLines.map((line) => line.trimEnd());
    }
  }
}
