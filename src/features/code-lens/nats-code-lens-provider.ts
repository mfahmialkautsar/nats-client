import * as vscode from "vscode";
import { parseNatsDocument } from "@/core/nats-document-parser";
import { NatsSession } from "@/services/nats-session";

const FILE_GLOB = "**/*.nats";

export class NatsCodeLensProvider implements vscode.CodeLensProvider {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses: vscode.Event<void> = this.emitter.event;

  constructor(private readonly session: NatsSession) {}

  dispose(): void {
    this.emitter.dispose();
  }

  refresh(): void {
    this.emitter.fire();
  }

  provideCodeLenses(
    document: vscode.TextDocument,
  ): vscode.ProviderResult<vscode.CodeLens[]> {
    const actions = parseNatsDocument(document.getText());
    const codeLenses: vscode.CodeLens[] = [];

    for (const action of actions) {
      const range = new vscode.Range(
        action.lineNumber,
        0,
        action.lineNumber,
        0,
      );
      const args: [string, number] = [document.fileName, action.lineNumber + 1];
      switch (action.type) {
        case "subscribe": {
          const key = buildKey(document.fileName, action.lineNumber + 1);
          const isSubscribed = this.session.isSubscribed(key);
          const activeCount = this.session.getSubscriptionCount(action.subject);
          codeLenses.push(
            new vscode.CodeLens(range, {
              title: `${isSubscribed ? "Unsubscribe" : "Subscribe"}${formatCount(activeCount)}`,
              command: isSubscribed
                ? "nats.stopSubscription"
                : "nats.startSubscription",
              arguments: args,
            }),
          );
          break;
        }
        case "request":
          codeLenses.push(
            new vscode.CodeLens(range, {
              title: "Send Request",
              command: "nats.sendRequest",
              arguments: args,
            }),
          );
          break;
        case "publish":
          codeLenses.push(
            new vscode.CodeLens(range, {
              title: "Publish",
              command: "nats.publish",
              arguments: args,
            }),
          );
          break;
        case "reply": {
          const key = buildKey(document.fileName, action.lineNumber + 1);
          const active = this.session.isReplyHandlerActive(key);
          const handlerCount = this.session.getReplyHandlerCount(
            action.subject,
          );
          codeLenses.push(
            new vscode.CodeLens(range, {
              title: `${active ? "Stop Reply Handler" : "Start Reply Handler"}${formatCount(handlerCount)}`,
              command: active
                ? "nats.stopReplyHandler"
                : "nats.startReplyHandler",
              arguments: args,
            }),
          );
          break;
        }
        case "jetstreamPull": {
          const batch = action.batchSize ?? 1;
          codeLenses.push(
            new vscode.CodeLens(range, {
              title: `Pull JetStream (batch ${batch})`,
              command: "nats.jetStreamPull",
              arguments: args,
            }),
          );
          break;
        }
        default:
          break;
      }
    }

    return codeLenses;
  }
}

export function registerCodeLensProvider(
  session: NatsSession,
  context: vscode.ExtensionContext,
): NatsCodeLensProvider {
  const provider = new NatsCodeLensProvider(session);
  context.subscriptions.push(
    provider,
    vscode.languages.registerCodeLensProvider({ pattern: FILE_GLOB }, provider),
  );
  return provider;
}

export function buildKey(filePath: string, line: number): string {
  return `${filePath}:${line}`;
}

function formatCount(count: number): string {
  return count > 0 ? ` (${count} active)` : "";
}
