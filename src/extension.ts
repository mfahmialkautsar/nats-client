import * as vscode from "vscode";
import { registerCodeLensProvider } from "@/features/code-lens/nats-code-lens-provider";
import { registerFormattingProvider } from "@/features/formatting/nats-formatting-provider";
import { createDefaultConnector } from "@/services/nats-connector";
import { NatsSession } from "@/services/nats-session";
import { OutputChannelRegistry } from "@/services/output-channel-registry";
import { createVsCodeChannelFactory } from "@/platform/vscode/output-channel-factory";
import { StatusBarController } from "@/platform/vscode/status-bar-controller";
import { registerVariableTree } from "@/platform/vscode/variable-tree-provider";
import { VariableCompletionProvider } from "@/features/completion/variable-completion-provider";
import { VariableHoverProvider } from "@/features/hover/variable-hover-provider";
import { JetStreamExplorerProvider } from "@/features/jetstream/jetstream-explorer-provider";
import { JetStreamFileSystemProvider } from "@/features/jetstream/jetstream-fs-provider";
import { VariableStore } from "@/services/variable-store";
import * as jetstreamPublishCmd from "@/commands/jetstream-publish";
import * as jetstreamConsumeCmd from "@/commands/jetstream-consume";
import { registerCommand } from "@/commands/registry";
import type { CommandContext } from "@/commands/context";

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

export type ExtensionAPI = {
  session: NatsSession;
  channelRegistry: OutputChannelRegistry;
};

export async function activate(context: vscode.ExtensionContext) {
  session = new NatsSession(createDefaultConnector(), context.globalState);
  channelRegistry = new OutputChannelRegistry(
    createVsCodeChannelFactory(),
    "NATS",
  );
  statusBar = new StatusBarController();
  const variableStore = new VariableStore(context.workspaceState);
  const codeLensProvider = registerCodeLensProvider(
    session,
    variableStore,
    context,
  );
  registerVariableTree(context, variableStore);

  registerFormattingProvider(context);

  const variableCompletionProvider = new VariableCompletionProvider(
    variableStore,
  );
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      "nats",
      variableCompletionProvider,
      "{",
    ),
  );

  const variableHoverProvider = new VariableHoverProvider(variableStore);
  context.subscriptions.push(
    vscode.languages.registerHoverProvider("nats", variableHoverProvider),
  );
  const jetStreamFileSystemProvider = new JetStreamFileSystemProvider(session);
  const jetStreamExplorerProvider = new JetStreamExplorerProvider(
    session,
    jetStreamFileSystemProvider,
  );
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      "natsJetStreamExplorer",
      jetStreamExplorerProvider,
    ),
  );
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(
      "nats-jetstream",
      jetStreamFileSystemProvider,
      { isCaseSensitive: true, isReadonly: false },
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("nats.jetStreamExplorer.refresh", () =>
      jetStreamExplorerProvider.refresh(),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "nats.jetStreamExplorer.createStream",
      (node) => jetStreamExplorerProvider.createStream(node),
    ),
    vscode.commands.registerCommand(
      "nats.jetStreamExplorer.deleteStream",
      (node) => jetStreamExplorerProvider.deleteStream(node),
    ),
    vscode.commands.registerCommand(
      "nats.jetStreamExplorer.createConsumer",
      (node) => jetStreamExplorerProvider.createConsumer(node),
    ),
    vscode.commands.registerCommand(
      "nats.jetStreamExplorer.deleteConsumer",
      (node) => jetStreamExplorerProvider.deleteConsumer(node),
    ),
    vscode.commands.registerCommand(
      "nats.jetStreamExplorer.viewStreamInfo",
      (node) => jetStreamExplorerProvider.viewStreamInfo(node),
    ),
    vscode.commands.registerCommand(
      "nats.jetStreamExplorer.viewConsumerInfo",
      (node) => jetStreamExplorerProvider.viewConsumerInfo(node),
    ),
  );

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

  registerCommand(
    context,
    "nats.jetstreamPublish",
    channelRegistry,
    (filePath: string, line: number) =>
      jetstreamPublishCmd.jetstreamPublish(ctx, filePath, line),
  );

  registerCommand(
    context,
    "nats.startJetStreamConsume",
    channelRegistry,
    (filePath: string, line: number) =>
      jetstreamConsumeCmd.startJetStreamConsume(ctx, filePath, line),
  );

  registerCommand(
    context,
    "nats.stopJetStreamConsume",
    channelRegistry,
    (filePath: string, line: number) =>
      jetstreamConsumeCmd.stopJetStreamConsume(ctx, filePath, line),
  );

  return { session, channelRegistry } as const;
}
export async function deactivate(): Promise<void> {
  if (session) {
    await session.reset();
  }
  channelRegistry?.disposeAll();
  statusBar?.dispose();
}
