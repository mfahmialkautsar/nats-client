import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";
import type * as vscode from "vscode";
import { NatsCodeLensProvider } from "@/features/code-lens/nats-code-lens-provider";
import * as parser from "@/core/nats-document-parser";
import type { VariableStore } from "@/services/variable-store";
import type { NatsSession } from "@/services/nats-session";

vi.mock("vscode", () => {
  class CodeLens {
    constructor(
      public range: unknown,
      public command: unknown,
    ) {}
  }
  class Position {
    constructor(
      public line: number,
      public character: number,
    ) {}
  }
  class Range {
    start: Position;
    end: Position;
    constructor(
      startLine: number,
      startChar: number,
      endLine: number,
      endChar: number,
    ) {
      this.start = new Position(startLine, startChar);
      this.end = new Position(endLine, endChar);
    }
  }
  return {
    CodeLens,
    Range,
    Position,
    EventEmitter: class {},
  };
});

vi.mock("@/core/nats-document-parser", () => ({
  parseNatsDocument: vi.fn(),
  buildKey: vi.fn(),
}));

interface MockSession {
  isSubscribed: Mock;
  getSubscriptionCount: Mock;
  isReplyHandlerActive: Mock;
  getReplyHandlerCount: Mock;
}

describe("NatsCodeLensProvider", () => {
  let provider: NatsCodeLensProvider;
  let mockVariableStore: VariableStore;
  let mockSession: MockSession;
  let document: vscode.TextDocument;

  beforeEach(() => {
    mockVariableStore = {
      getAllVariables: vi.fn(),
      onDidChange: vi.fn(),
    } as unknown as VariableStore;

    mockSession = {
      isSubscribed: vi.fn(),
      getSubscriptionCount: vi.fn(),
      isReplyHandlerActive: vi.fn(),
      getReplyHandlerCount: vi.fn(),
    };

    // Correct constructor signature: session, variableStore
    provider = new NatsCodeLensProvider(
      mockSession as unknown as NatsSession,
      mockVariableStore,
    );

    document = {
      getText: vi.fn(),
      fileName: "test.nats",
      uri: { toString: () => "file:///test.nats" },
    } as unknown as vscode.TextDocument;
  });

  it("returns CodeLenses for parsed actions", () => {
    (document.getText as Mock).mockReturnValue("content");
    (mockVariableStore.getAllVariables as Mock).mockReturnValue({});

    const mockActions = [
      {
        type: "publish",
        kind: "publish",
        subject: "test.subject",
        lineNumber: 10,
      },
    ];
    (parser.parseNatsDocument as Mock).mockReturnValue(mockActions);

    const lenses = provider.provideCodeLenses(document) as vscode.CodeLens[];

    expect(lenses).toHaveLength(1);
    expect(lenses[0].command).toBeDefined();
    expect(lenses[0].command!.title).toBe("Publish");
    expect(lenses[0].range.start.line).toBe(10);
    expect(lenses[0].command!.arguments).toEqual(["test.nats", 11]);
  });

  it("returns empty array if no actions", () => {
    (document.getText as Mock).mockReturnValue("content");
    (parser.parseNatsDocument as Mock).mockReturnValue([]);

    const lenses = provider.provideCodeLenses(document) as vscode.CodeLens[];
    expect(lenses).toHaveLength(0);
  });
});
