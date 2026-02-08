import * as vscode from "vscode";
import { parseNatsDocument } from "@/core/nats-document-parser";
import type { NatsSession } from "@/services/nats-session";
import type { VariableStore } from "@/services/variable-store";
import type { NatsAction } from "@/core/nats-actions";

const FILE_GLOB = "**/*.nats";

export class NatsCodeLensProvider implements vscode.CodeLensProvider {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses: vscode.Event<void> = this.emitter.event;

  constructor(
    private readonly session: NatsSession,
    private readonly variableStore: VariableStore,
  ) {}

  dispose(): void {
    this.emitter.dispose();
  }

  refresh(): void {
    this.emitter.fire();
  }

  provideCodeLenses(
    document: vscode.TextDocument,
  ): vscode.ProviderResult<vscode.CodeLens[]> {
    const text = document.getText();
    const globalVariables = this.variableStore.getAllVariables();
    const actions = parseNatsDocument(text, globalVariables);
    const codeLenses: vscode.CodeLens[] = [];

    for (const action of actions) {
      const range = new vscode.Range(
        action.lineNumber,
        0,
        action.lineNumber,
        0,
      );
      const args: [string, number] = [document.fileName, action.lineNumber + 1];
      const lens = this.createLens(document, action, range, args);
      if (lens) {
        codeLenses.push(lens);
      }
    }

    return codeLenses;
  }

  private createLens(
    document: vscode.TextDocument,
    action: NatsAction,
    range: vscode.Range,
    args: [string, number],
  ): vscode.CodeLens | undefined {
    switch (action.type) {
      case "subscribe":
        return this.createSubscribeLens(
          document,
          action as NatsAction & { type: "subscribe" },
          range,
          args,
        );
      case "request":
        return new vscode.CodeLens(range, {
          title: "Send Request",
          command: "nats.sendRequest",
          arguments: args,
        });
      case "publish":
        return new vscode.CodeLens(range, {
          title: "Publish",
          command: "nats.publish",
          arguments: args,
        });
      case "reply":
        return this.createReplyLens(
          document,
          action as NatsAction & { type: "reply" },
          range,
          args,
        );
      case "jetstreamPublish":
        return new vscode.CodeLens(range, {
          title: "JetStream Publish",
          command: "nats.jetstreamPublish",
          arguments: args,
        });
      case "jetstreamConsume":
        return this.createJetStreamConsumeLens(
          action as NatsAction & { type: "jetstreamConsume" },
          range,
          args,
        );
      default:
        return undefined;
    }
  }

  private createSubscribeLens(
    document: vscode.TextDocument,
    action: NatsAction & { type: "subscribe" },
    range: vscode.Range,
    args: [string, number],
  ): vscode.CodeLens {
    const key = buildKey(document.fileName, action.lineNumber + 1);
    const isSubscribed = this.session.isSubscribed(key);
    const activeCount = this.session.getSubscriptionCount(action.subject);
    return new vscode.CodeLens(range, {
      title: `${isSubscribed ? "Unsubscribe" : "Subscribe"}${formatCount(activeCount)}`,
      command: isSubscribed
        ? "nats.stopSubscription"
        : "nats.startSubscription",
      arguments: args,
    });
  }

  private createReplyLens(
    document: vscode.TextDocument,
    action: NatsAction & { type: "reply" },
    range: vscode.Range,
    args: [string, number],
  ): vscode.CodeLens {
    const key = buildKey(document.fileName, action.lineNumber + 1);
    const active = this.session.isReplyHandlerActive(key);
    const handlerCount = this.session.getReplyHandlerCount(action.subject);
    return new vscode.CodeLens(range, {
      title: `${active ? "Stop Reply Handler" : "Start Reply Handler"}${formatCount(handlerCount)}`,
      command: active ? "nats.stopReplyHandler" : "nats.startReplyHandler",
      arguments: args,
    });
  }

  private createJetStreamConsumeLens(
    action: NatsAction & { type: "jetstreamConsume" },
    range: vscode.Range,
    args: [string, number],
  ): vscode.CodeLens {
    const stream = action.stream
      ? this.variableStore.resolveText(action.stream)
      : "";
    const durable = action.durable
      ? this.variableStore.resolveText(action.durable)
      : "";
    const server = action.server
      ? this.variableStore.resolveText(action.server)
      : "";
    const key = `${server}|${stream}/${durable}`;
    const isSubscribed = this.session.isSubscribed(key);
    const activeCount = this.session.getSubscriptionCount(
      `${stream}/${durable}`,
    );

    return new vscode.CodeLens(range, {
      title: `${isSubscribed ? "Stop Consumption" : "Start Consumption"}${formatCount(activeCount)}`,
      command: isSubscribed
        ? "nats.stopJetStreamConsume"
        : "nats.startJetStreamConsume",
      arguments: args,
    });
  }
}

export function registerCodeLensProvider(
  session: NatsSession,
  variableStore: VariableStore,
  context: vscode.ExtensionContext,
): NatsCodeLensProvider {
  const provider = new NatsCodeLensProvider(session, variableStore);
  context.subscriptions.push(
    provider,
    vscode.languages.registerCodeLensProvider(
      [{ pattern: FILE_GLOB }, { scheme: "untitled", language: "nats" }],
      provider,
    ),
  );
  return provider;
}

export function buildKey(filePath: string, line: number): string {
  return `${filePath}:${line}`;
}

function formatCount(count: number): string {
  return count > 0 ? ` (${count} active)` : "";
}
