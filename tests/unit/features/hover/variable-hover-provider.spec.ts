import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";
import * as vscode from "vscode";
import { VariableHoverProvider } from "@/features/hover/variable-hover-provider";
import type { VariableStore } from "@/services/variable-store";

vi.mock("vscode", () => {
  class MarkdownString {
    constructor(public value: string) {}
    appendMarkdown(s: string) {
      this.value += s;
      return this;
    }
  }
  class Hover {
    constructor(public contents: MarkdownString[]) {}
  }
  return {
    MarkdownString,
    Hover,
  };
});

describe("VariableHoverProvider", () => {
  let variableStore: VariableStore;
  let provider: VariableHoverProvider;
  let document: vscode.TextDocument;

  beforeEach(() => {
    // Mock internal dependency: VariableStore
    variableStore = {
      getAllVariables: vi.fn(),
      get: vi.fn(),
    } as unknown as VariableStore;
    provider = new VariableHoverProvider(variableStore);

    document = {
      getWordRangeAtPosition: vi.fn(),
      getText: vi.fn(),
    } as unknown as vscode.TextDocument;
  });

  it("returns undefined when no variable is found at position", () => {
    (document.getWordRangeAtPosition as Mock).mockReturnValue(undefined);
    const result = provider.provideHover(document, {} as vscode.Position);
    expect(result).toBeUndefined();
  });

  it("returns global variable hover", () => {
    const range = {};
    (document.getWordRangeAtPosition as Mock).mockReturnValue(range);
    (document.getText as Mock).mockImplementation((r: unknown) => {
      if (r === range) {
        return "{{host}}";
      }
      return "";
    });
    (variableStore.get as Mock).mockReturnValue("localhost");

    const result = provider.provideHover(
      document,
      {} as vscode.Position,
    ) as vscode.Hover;

    expect(result).toBeInstanceOf(vscode.Hover);
    const contents = result.contents as unknown as { value: string };
    expect(contents.value).toContain("Global Variable");
    expect(contents.value).toContain("localhost");
  });

  it("returns local variable hover", () => {
    const range = {};
    (document.getWordRangeAtPosition as Mock).mockReturnValue(range);
    const fullText = "@msg = hello\n{{msg}}";
    (document.getText as Mock).mockImplementation((r: unknown) => {
      if (r === range) {
        return "{{msg}}";
      }
      return fullText;
    });
    (variableStore.get as Mock).mockReturnValue(undefined);

    const result = provider.provideHover(
      document,
      {} as vscode.Position,
    ) as vscode.Hover;

    expect(result).toBeInstanceOf(vscode.Hover);
    const contents = result.contents as unknown as { value: string };
    expect(contents.value).toContain("Local Variable");
    expect(contents.value).toContain("hello");
  });

  it("returns undefined if variable not found", () => {
    const range = {};
    (document.getWordRangeAtPosition as Mock).mockReturnValue(range);
    (document.getText as Mock).mockImplementation((r: unknown) => {
      if (r === range) {
        return "{{unknown}}";
      }
      return "";
    });
    (variableStore.get as Mock).mockReturnValue(undefined);

    const result = provider.provideHover(
      document,
      {} as vscode.Position,
    ) as vscode.Hover;

    expect(result).toBeUndefined();
  });
});
