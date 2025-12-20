import * as vscode from "vscode";
import { registerCodeLensProvider } from "@/features/code-lens/nats-code-lens-provider";
import { registerJetStreamPullCommand } from "@/features/jetstream/register-jetstream-pull-command";
import { registerFormattingProvider } from "@/features/formatting/nats-formatting-provider";
import { createDefaultConnector } from "@/services/nats-connector";
import { NatsSession } from "@/services/nats-session";
import { OutputChannelRegistry } from "@/services/output-channel-registry";
import { createVsCodeChannelFactory } from "@/platform/vscode/output-channel-factory";
import { StatusBarController } from "@/platform/vscode/status-bar-controller";
import { registerVariableTree } from "@/platform/vscode/variable-tree-provider";
import { VariableStore } from "@/services/variable-store";
import { readSettings } from "@/services/configuration";
import { registerCommand } from "@/commands/registry";
import { CommandContext } from "@/commands/context";
import { resolveAction, resolveServer } from "@/commands/utils";

import * as subscribeCmd from "@/commands/subscribe";
import * as publishCmd from "@/commands/publish";
import * as requestCmd from "@/commands/request";
import * as replyCmd from "@/commands/reply";
import * as connectionsCmd from "@/commands/connections";
import * as showOutputCmd from "@/commands/show-output";
import * as showSubsCmd from "@/commands/show-subscriptions";
import * as showReplyCmd from "@/commands/show-reply-handlers";

let session: NatsSession;
let channelRegistry: OutputChannelRegistry;
let statusBar: StatusBarController;

export async function activate(context: vscode.ExtensionContext) {
  session = new NatsSession(createDefaultConnector());
  channelRegistry = new OutputChannelRegistry(
    createVsCodeChannelFactory(),
    "NATS",
  );
  statusBar = new StatusBarController();
  const codeLensProvider = registerCodeLensProvider(session, context);
  const variableStore = new VariableStore(context.workspaceState);
  registerVariableTree(context, variableStore);
  registerFormattingProvider(context);

  context.subscriptions.push(
    new vscode.Disposable(() => channelRegistry.disposeAll()),
    statusBar,
  );

  const ctx: CommandContext = {
    context,
    session,
    channelRegistry,
    variableStore,
    statusBar,
    codeLensProvider,
  };

  const settings = readSettings();

  registerCommand(context, "nats.showOutput", channelRegistry, () =>
    showOutputCmd.showOutput(ctx),
  );

  registerCommand(context, "nats.showSubscriptions", channelRegistry, () =>
    showSubsCmd.showSubscriptions(ctx),
  );

  registerCommand(context, "nats.showReplyHandlers", channelRegistry, () =>
    showReplyCmd.showReplyHandlers(ctx),
  );

  registerCommand(context, "nats.connections.menu", channelRegistry, () =>
    connectionsCmd.connectionsMenu(ctx),
  );

  registerCommand(context, "nats.connections.reset", channelRegistry, () =>
    connectionsCmd.resetConnections(ctx),
  );

  registerCommand(
    context,
    "nats.startSubscription",
    channelRegistry,
    (filePath: string, line: number) =>
      subscribeCmd.startSubscription(ctx, filePath, line),
  );

  registerCommand(
    context,
    "nats.stopSubscription",
    channelRegistry,
    (filePath: string, line: number) =>
      subscribeCmd.stopSubscription(ctx, filePath, line),
  );

  registerCommand(
    context,
    "nats.sendRequest",
    channelRegistry,
    (filePath: string, line: number) =>
      requestCmd.sendRequest(ctx, filePath, line),
  );

  registerCommand(
    context,
    "nats.publish",
    channelRegistry,
    (filePath: string, line: number) => publishCmd.publish(ctx, filePath, line),
  );

  registerCommand(
    context,
    "nats.startReplyHandler",
    channelRegistry,
    (filePath: string, line: number) =>
      replyCmd.startReplyHandler(ctx, filePath, line),
  );

  registerCommand(
    context,
    "nats.stopReplyHandler",
    channelRegistry,
    (filePath: string, line: number) =>
      replyCmd.stopReplyHandler(ctx, filePath, line),
  );

  registerJetStreamPullCommand({
    session,
    channelRegistry,
    defaultTimeoutMs: settings.requestTimeoutMs,
    resolveAction,
    resolveText: (value) => variableStore.resolveText(value),
    resolveServer: (value) => resolveServer(value, variableStore),
    register: (command, callback) =>
      registerCommand(
        context,
        command,
        channelRegistry,
        async (...args: any[]) => {
          await Promise.resolve(callback(...args));
          statusBar.updateConnectionCount(session.connectionCount());
        },
      ),
  });

  return { session, channelRegistry } as const;
}

export async function deactivate(): Promise<void> {
  if (session) {
    await session.reset();
  }
  channelRegistry?.disposeAll();
  statusBar?.dispose();
}
