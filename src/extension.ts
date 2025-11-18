import * as vscode from "vscode";
import {
  parseNatsDocument,
  findActionNearestLine,
} from "@/core/nats-document-parser";
import { NatsActionType, NatsAction } from "@/core/nats-actions";
import {
  registerCodeLensProvider,
  buildKey,
} from "@/features/code-lens/nats-code-lens-provider";
import { registerJetStreamPullCommand } from "@/features/jetstream/register-jetstream-pull-command";
import { registerFormattingProvider } from "@/features/formatting/nats-formatting-provider";
import { createDefaultConnector } from "@/services/nats-connector";
import { NatsSession } from "@/services/nats-session";
import { OutputChannelRegistry } from "@/services/output-channel-registry";
import { createVsCodeChannelFactory } from "@/platform/vscode/output-channel-factory";
import { StatusBarController } from "@/platform/vscode/status-bar-controller";
import { registerVariableTree } from "@/platform/vscode/variable-tree-provider";
import { VariableStore } from "@/services/variable-store";
import { appendLogBlock } from "@/services/log-sink";

let session: NatsSession;
let channelRegistry: OutputChannelRegistry;
let statusBar: StatusBarController;
let codeLensProvider: ReturnType<typeof registerCodeLensProvider>;
let variableStore: VariableStore;

export async function activate(context: vscode.ExtensionContext) {
  session = new NatsSession(createDefaultConnector());
  channelRegistry = new OutputChannelRegistry(
    createVsCodeChannelFactory(),
    "NATS",
  );
  statusBar = new StatusBarController();
  codeLensProvider = registerCodeLensProvider(session, context);
  variableStore = new VariableStore(context.workspaceState);
  registerVariableTree(context, variableStore);
  registerFormattingProvider(context);

  context.subscriptions.push(
    new vscode.Disposable(() => channelRegistry.disposeAll()),
    statusBar,
  );

  const settings = readSettings();

  const updateConnections = () =>
    statusBar.updateConnectionCount(session.connectionCount());

  registerCommand(context, "nats.showOutput", () => {
    channelRegistry.main().show(true);
  });

  registerCommand(context, "nats.showSubscriptions", () => {
    void (async () => {
      const subs = session.listSubscriptions();
      if (subs.length === 0) {
        void vscode.window.showInformationMessage("No active subscriptions");
        return;
      }
      const items: vscode.QuickPickItem[] = subs.map((s) => ({
        label: s.subject,
        description: s.server,
        detail: s.key,
      }));
      const selection = await vscode.window.showQuickPick(items, {
        placeHolder: "Select a subscription to manage",
      });
      if (!selection) {
        return;
      }

      const actions: vscode.QuickPickItem[] = [
        { label: "Unsubscribe", description: "Stop the subscription" },
        { label: "Show Output", description: "Reveal output channel" },
        { label: "Copy Subject", description: "Copy subject to clipboard" },
      ];
      const action = await vscode.window.showQuickPick(actions, {
        placeHolder: `Action for ${selection.label}`,
      });
      if (!action) {
        return;
      }
      switch (action.label) {
        case "Unsubscribe": {
          session.stopSubscription(selection.detail ?? "");
          channelRegistry.release(selection.detail ?? "");
          vscode.window.showInformationMessage(
            `Unsubscribed from ${selection.label}`,
          );
          codeLensProvider.refresh();
          updateConnections();
          break;
        }
        case "Show Output": {
          const ch = channelRegistry.acquire(
            selection.label,
            selection.detail ?? "",
          );
          ch.show(true);
          break;
        }
        case "Copy Subject": {
          await vscode.env.clipboard.writeText(selection.label);
          vscode.window.showInformationMessage("Subject copied to clipboard");
          break;
        }
        default:
          break;
      }
    })();
  });

  registerCommand(context, "nats.showReplyHandlers", () => {
    void (async () => {
      const handlers = session.listReplyHandlers();
      if (handlers.length === 0) {
        void vscode.window.showInformationMessage("No active reply handlers");
        return;
      }
      const items: vscode.QuickPickItem[] = handlers.map((h) => ({
        label: h.subject,
        description: h.server,
        detail: h.key,
      }));
      const selection = await vscode.window.showQuickPick(items, {
        placeHolder: "Select a reply handler to manage",
      });
      if (!selection) {
        return;
      }

      const actions: vscode.QuickPickItem[] = [
        { label: "Stop Reply Handler", description: "Stop the reply handler" },
        { label: "Show Output", description: "Reveal output channel" },
        { label: "Copy Subject", description: "Copy subject to clipboard" },
      ];
      const action = await vscode.window.showQuickPick(actions, {
        placeHolder: `Action for ${selection.label}`,
      });
      if (!action) {
        return;
      }
      switch (action.label) {
        case "Stop Reply Handler": {
          session.stopReplyHandler(selection.detail ?? "");
          channelRegistry.release(selection.detail ?? "");
          vscode.window.showInformationMessage(
            `Stopped reply handler for ${selection.label}`,
          );
          codeLensProvider.refresh();
          updateConnections();
          break;
        }
        case "Show Output": {
          const ch = channelRegistry.acquire(
            selection.label,
            selection.detail ?? "",
          );
          ch.show(true);
          break;
        }
        case "Copy Subject": {
          await vscode.env.clipboard.writeText(selection.label);
          vscode.window.showInformationMessage("Subject copied to clipboard");
          break;
        }
        default:
          break;
      }
    })();
  });

  registerCommand(context, "nats.connections.menu", async () => {
    const connections = session.listConnections();
    const items: vscode.QuickPickItem[] = [
      { label: "$(sync) Reset all connections", description: "reset" },
      { label: "$(info) View details", description: "view" },
    ];
    const selection = await vscode.window.showQuickPick(items, {
      placeHolder: "Manage NATS connections",
    });
    if (!selection) {
      return;
    }
    switch (selection.description) {
      case "reset": {
        await session.reset();
        channelRegistry.disposeAll();
        codeLensProvider.refresh();
        updateConnections();
        vscode.window.showInformationMessage(
          "All NATS connections have been reset",
        );
        break;
      }
      case "view": {
        if (connections.length === 0) {
          vscode.window.showInformationMessage("No active connections");
          return;
        }
        const details = connections.map((conn) => `${conn.server}`).join("\n");
        vscode.window.showInformationMessage(
          `Active connections:\n${details}`,
          { modal: true },
        );
        break;
      }
      default:
        break;
    }
  });

  registerCommand(context, "nats.connections.reset", async () => {
    await session.reset();
    channelRegistry.disposeAll();
    codeLensProvider.refresh();
    updateConnections();
    vscode.window.showInformationMessage(
      "All NATS connections have been reset",
    );
  });

  registerCommand(
    context,
    "nats.startSubscription",
    async (filePath: string, line: number) => {
      const action = await resolveAction(filePath, line, "subscribe");
      if (!action) {
        vscode.window.showErrorMessage(
          "SUBSCRIBE action not found on this line",
        );
        return;
      }
      const server = resolveServer(action.server);
      if (!server) {
        vscode.window.showErrorMessage(
          "SUBSCRIBE block must specify a server (inline or via NATS-Server header)",
        );
        return;
      }
      const subject = variableStore.resolveText(action.subject);
      const key = buildKey(filePath, line);
      const channel = channelRegistry.acquire(subject, key);
      try {
        await session.startSubscription(server, subject, channel, key);
        channel.show(true);
        vscode.window.showInformationMessage(
          `Subscription started on ${subject}`,
        );
        updateConnections();
      } catch (error) {
        channelRegistry.release(key);
        throw error;
      }
      codeLensProvider.refresh();
    },
  );

  registerCommand(
    context,
    "nats.stopSubscription",
    async (filePath: string, line: number) => {
      const key = buildKey(filePath, line);
      session.stopSubscription(key);
      channelRegistry.release(key);
      vscode.window.showInformationMessage("Subscription stopped");
      codeLensProvider.refresh();
    },
  );

  registerCommand(
    context,
    "nats.sendRequest",
    async (filePath: string, line: number) => {
      const action = await resolveAction(filePath, line, "request");
      if (!action) {
        vscode.window.showErrorMessage("REQUEST action not found on this line");
        return;
      }
      const server = resolveServer(action.server);
      if (!server) {
        vscode.window.showErrorMessage(
          "REQUEST block must specify a server (inline or via NATS-Server header)",
        );
        return;
      }
      const subject = variableStore.resolveText(action.subject);
      const payload = variableStore.resolveOptional(action.data) ?? "";
      const headers = variableStore.resolveRecord(action.headers);
      const result = await session.sendRequest(
        server,
        subject,
        payload,
        { timeoutMs: action.timeoutMs ?? settings.requestTimeoutMs },
        headers,
      );
      const mainChannel = channelRegistry.main();
      appendLogBlock(mainChannel, result);
      if (settings.autoRevealOutput) {
        mainChannel.show(true);
      }
      updateConnections();
    },
  );

  registerCommand(
    context,
    "nats.publish",
    async (filePath: string, line: number) => {
      const action = await resolveAction(filePath, line, "publish");
      if (!action) {
        vscode.window.showErrorMessage("PUBLISH action not found on this line");
        return;
      }
      const server = resolveServer(action.server);
      if (!server) {
        vscode.window.showErrorMessage(
          "PUBLISH block must specify a server (inline or via NATS-Server header)",
        );
        return;
      }
      const subject = variableStore.resolveText(action.subject);
      const payload = variableStore.resolveOptional(action.data) ?? "";
      const headers = variableStore.resolveRecord(action.headers);
      const result = await session.publish(server, subject, payload, headers);
      const mainChannel = channelRegistry.main();
      appendLogBlock(mainChannel, result);
      if (settings.autoRevealOutput) {
        mainChannel.show(true);
      }
      vscode.window.showInformationMessage(`Published to ${subject}`);
      updateConnections();
    },
  );

  registerCommand(
    context,
    "nats.startReplyHandler",
    async (filePath: string, line: number) => {
      const action = await resolveAction(filePath, line, "reply");
      if (!action) {
        vscode.window.showErrorMessage("REPLY action not found on this line");
        return;
      }
      if (!action.template && !action.data) {
        vscode.window.showErrorMessage(
          "Reply handler requires a template or payload",
        );
        return;
      }
      const server = resolveServer(action.server);
      if (!server) {
        vscode.window.showErrorMessage(
          "REPLY block must specify a server (inline or via NATS-Server header)",
        );
        return;
      }
      const key = buildKey(filePath, line);
      const subject = variableStore.resolveText(action.subject);
      const headers = variableStore.resolveRecord(action.headers);
      const channel = channelRegistry.acquire(`Reply:${subject}`, key);
      try {
        const template = variableStore.resolveOptional(action.template);
        const payload = variableStore.resolveOptional(action.data);
        await session.startReplyHandler(
          server,
          subject,
          template,
          payload,
          channel,
          key,
          headers,
        );
        channel.show(true);
        vscode.window.showInformationMessage(
          `Reply handler started for ${subject}`,
        );
        updateConnections();
      } catch (error) {
        channelRegistry.release(key);
        throw error;
      }
      codeLensProvider.refresh();
    },
  );

  registerCommand(
    context,
    "nats.stopReplyHandler",
    (filePath: string, line: number) => {
      const key = buildKey(filePath, line);
      session.stopReplyHandler(key);
      channelRegistry.release(key);
      vscode.window.showInformationMessage("Reply handler stopped");
      codeLensProvider.refresh();
    },
  );

  registerJetStreamPullCommand({
    session,
    channelRegistry,
    defaultTimeoutMs: settings.requestTimeoutMs,
    resolveAction,
    resolveText: (value) => variableStore.resolveText(value),
    resolveServer,
    register: (command, callback) =>
      registerCommand(context, command, async (...args: any[]) => {
        await Promise.resolve(callback(...args));
        updateConnections();
      }),
  });
}

export async function deactivate(): Promise<void> {
  if (session) {
    await session.reset();
  }
  channelRegistry?.disposeAll();
  statusBar?.dispose();
}

function registerCommand(
  context: vscode.ExtensionContext,
  command: string,
  callback: (...args: any[]) => Thenable<void> | void,
): void {
  const disposable = vscode.commands.registerCommand(
    command,
    async (...args: any[]) => {
      try {
        await Promise.resolve(callback(...args));
      } catch (error) {
        reportError(error, `Command ${command} failed`);
      }
    },
  );
  context.subscriptions.push(disposable);
}

async function resolveAction(
  filePath: string,
  line: number,
  type: NatsActionType,
): Promise<NatsAction | undefined> {
  const document = await vscode.workspace.openTextDocument(
    vscode.Uri.file(filePath),
  );
  const actions = parseNatsDocument(document.getText());
  return findActionNearestLine(actions, line - 1, type);
}

function reportError(error: unknown, message: string): void {
  const errorMsg = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  vscode.window.showErrorMessage(`${message}: ${errorMsg}`);

  const channel = channelRegistry.main();
  const meta = { timestamp: new Date().toISOString() };
  const items = [
    { title: "ERROR", body: message },
    { title: "Message", body: errorMsg },
  ];
  if (stack) {
    items.push({ title: "Stack trace", body: stack });
  }
  appendLogBlock(channel, { meta, items }, "");
  console.error(message, error);
}

interface ExtensionSettings {
  requestTimeoutMs: number;
  autoRevealOutput: boolean;
}

function readSettings(): ExtensionSettings {
  const config = vscode.workspace.getConfiguration("natsClient");
  return {
    requestTimeoutMs: config.get("requestTimeoutMs", 15000),
    autoRevealOutput: config.get("autoRevealOutput", false),
  };
}

function resolveServer(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const resolved = variableStore.resolveText(value);
  return resolved.trim().length > 0 ? resolved : undefined;
}
