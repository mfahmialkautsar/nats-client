import * as vscode from "vscode";
import { segmentNatsDocument, RawLine } from "@/core/nats-document-parser";

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

  format(text: string): string {
    const segments = segmentNatsDocument(text);
    const lines: string[] = [];
    const pushLine = (value: string): void => {
      if (value.length === 0) {
        if (lines.length === 0 || lines[lines.length - 1].length === 0) {
          return;
        }
      }
      lines.push(value);
    };

    for (const segment of segments) {
      if (segment.kind === "delimiter") {
        if (lines.length > 0 && lines[lines.length - 1].length !== 0) {
          lines.push("");
        }
        lines.push("###");
        lines.push("");
        continue;
      }
      if (segment.lines.length === 0) {
        continue;
      }
      const block = this.formatBlock(segment.lines);
      if (block.length === 0) {
        continue;
      }
      if (lines.length > 0 && lines[lines.length - 1].length !== 0) {
        lines.push("");
      }
      for (const line of block) {
        pushLine(line);
      }
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
      return lines.map((line) => line.text.replace(/\s+$/, "")); // trim trailing whitespace only
    }
    const before = lines
      .slice(0, requestIndex)
      .map((line) => line.text.replace(/\s+$/, ""));
    const verb = this.extractVerb(lines[requestIndex].text);
    const requestLine = this.formatRequestLine(lines[requestIndex].text);
    const { headerLines, nextIndex } = this.extractHeaders(
      lines,
      requestIndex + 1,
    );
    const bodyLines = this.formatBody(lines.slice(nextIndex));

    const output: string[] = [];
    for (const prefix of before) {
      if (prefix.trim().length === 0) {
        if (output.length === 0 || output[output.length - 1].length === 0) {
          continue;
        }
        output.push("");
        continue;
      }
      output.push(prefix);
    }
    output.push(requestLine);
    for (const header of headerLines) {
      output.push(header);
    }
    if (
      bodyLines.length > 0 &&
      (headerLines.length > 0 || this.shouldPadHeaderlessBody(verb))
    ) {
      output.push("");
    }
    for (const line of bodyLines) {
      output.push(line);
    }
    return output;
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
        ["SUBSCRIBE", "REQUEST", "PUBLISH", "REPLY", "JETSTREAM"].includes(
          upper,
        )
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
      return bodyLines.map((line) => line.replace(/\s+$/, ""));
    }
    try {
      const parsed = JSON.parse(body);
      return JSON.stringify(parsed, null, 2).split("\n");
    } catch {
      return bodyLines.map((line) => line.replace(/\s+$/, ""));
    }
  }
}
