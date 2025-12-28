import { describe, expect, it, vi, type Mock } from "vitest";
import * as vscode from "vscode";
import {
  NatsFormatter,
  registerFormattingProvider,
} from "@/features/formatting/nats-formatting-provider";

vi.mock("vscode", () => {
  const registerDocumentFormattingEditProvider = vi.fn(
    (_selector, provider) => ({
      dispose: vi.fn(),
      provider,
    }),
  );
  class Range {
    constructor(
      public startLine: number,
      public startCharacter: number,
      public endLine: number,
      public endCharacter: number,
    ) {}
  }
  const TextEdit = {
    replace: (range: Range, newText: string) => ({ range, newText }),
  };
  return {
    languages: { registerDocumentFormattingEditProvider },
    Range,
    TextEdit,
  };
});

const formatter = new NatsFormatter();

describe("NatsFormatter", () => {
  it("inserts a blank line between REPLY and a headerless body", () => {
    const formatted = formatter.format('REPLY lab.echo\n{"value":1}\n');
    expect(formatted).toBe('REPLY lab.echo\n\n{\n  "value": 1\n}\n');
  });

  it("inserts a blank line between PUBLISH and a headerless body", () => {
    const formatted = formatter.format('PUBLISH lab.metrics\n{"value":1}\n');
    expect(formatted).toBe('PUBLISH lab.metrics\n\n{\n  "value": 1\n}\n');
  });

  it("preserves blank line under command when not followed by headers", () => {
    const formatted = formatter.format('REQUEST demo.q\n\n{"value":1}\n');
    expect(formatted).toBe('REQUEST demo.q\n\n{\n  "value": 1\n}\n');
  });

  it("does not preserve blank line under command when followed by headers", () => {
    const text = [
      "REQUEST demo.q",
      "",
      "Trace-Id: abc",
      "",
      '{"value":1}',
      "",
    ].join("\n");
    const expected = [
      "REQUEST demo.q",
      "Trace-Id: abc",
      "",
      "{",
      '  "value": 1',
      "}",
      "",
    ].join("\n");
    expect(formatter.format(text)).toBe(expected);
  });

  it("normalizes verbs, preserves comments, and spaces delimiters consistently", () => {
    const text = [
      "// note",
      "request   demo.queue",
      "Trace-Id: abc",
      "",
      '{"value":1}',
      "",
      "### Section A",
      "publish demo.events",
      "",
      '"value"',
      "",
    ].join("\n");
    const expected = [
      "// note",
      "REQUEST demo.queue",
      "Trace-Id: abc",
      "",
      "{",
      '  "value": 1',
      "}",
      "",
      "### Section A",
      "",
      "PUBLISH demo.events",
      "",
      '"value"',
      "",
    ].join("\n");
    expect(formatter.format(text)).toBe(expected);
  });

  it("leaves malformed JSON bodies untouched when parsing fails", () => {
    const text = "PUBLISH demo.topic\n{not-json\n";
    expect(formatter.format(text)).toBe("PUBLISH demo.topic\n\n{not-json\n");
  });
});

describe("registerFormattingProvider", () => {
  it("returns no edits when a document is already formatted", () => {
    const context = {
      subscriptions: [] as Array<{ dispose(): void }>,
    } as unknown as vscode.ExtensionContext;
    registerFormattingProvider(context);
    const registerMock = vscode.languages
      .registerDocumentFormattingEditProvider as unknown as Mock;
    const call = registerMock.mock.calls.pop();
    expect(call).toBeDefined();
    const provider = call![1];
    const document = {
      getText: () => "SUBSCRIBE lab.metrics\n",
      lineCount: 1,
      lineAt: () => ({ text: "SUBSCRIBE lab.metrics" }),
    } as unknown as vscode.TextDocument;
    expect(provider.provideDocumentFormattingEdits(document)).toEqual([]);
  });

  it("produces a single replace edit covering the entire document when formatting changes", () => {
    const context = {
      subscriptions: [] as Array<{ dispose(): void }>,
    } as unknown as vscode.ExtensionContext;
    registerFormattingProvider(context);
    const registerMock = vscode.languages
      .registerDocumentFormattingEditProvider as unknown as Mock;
    const call = registerMock.mock.calls.pop();
    const provider = call![1];
    const document = {
      getText: () => 'REPLY lab.echo\n{"value":1}\n',
      lineCount: 2,
      lineAt: (line: number) => ({
        text: line === 0 ? "REPLY lab.echo" : '{"value":1}',
      }),
    } as unknown as vscode.TextDocument;
    const edits = provider.provideDocumentFormattingEdits(document);
    expect(edits).toHaveLength(1);
    expect(edits[0].newText).toBe('REPLY lab.echo\n\n{\n  "value": 1\n}\n');
  });
});
