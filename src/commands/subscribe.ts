import * as vscode from "vscode";
import { CommandContext } from "./context";
import {
  handleError,
  resolveAction,
  resolveServer,
  revealIfNew,
} from "./utils";
import { buildKey } from "@/features/code-lens/nats-code-lens-provider";
import { CompositeLogSink } from "@/services/log-sink";

export async function startSubscription(
  ctx: CommandContext,
  filePath: string,
  line: number,
) {
  const action = await resolveAction(filePath, line, "subscribe");
  if (!action) {
    vscode.window.showErrorMessage("SUBSCRIBE action not found on this line");
    return;
  }
  const server = resolveServer(action.server, ctx.variableStore);
  if (!server) {
    vscode.window.showErrorMessage(
      "SUBSCRIBE block must specify a server (inline or via NATS-Server header)",
    );
    return;
  }
  const subject = ctx.variableStore.resolveText(action.subject);
  const key = buildKey(filePath, line);
  const { channel, isNew } = ctx.channelRegistry.acquire(subject, key);
  try {
    const main = ctx.channelRegistry.main();
    const sink = new CompositeLogSink([main, channel]);
    await ctx.session.startSubscription(server, subject, sink, key);
    revealIfNew(ctx, channel, isNew);
    vscode.window.showInformationMessage(`Subscription started on ${subject}`);
    ctx.statusBar.updateConnectionCount(ctx.session.connectionCount());
  } catch (error) {
    ctx.channelRegistry.release(key);
    handleError(ctx, error, "Subscription failed", server, subject);
  }
  ctx.codeLensProvider.refresh();
}

export async function stopSubscription(
  ctx: CommandContext,
  filePath: string,
  line: number,
) {
  try {
    const key = buildKey(filePath, line);
    ctx.session.stopSubscription(key);
    ctx.channelRegistry.release(key);
    vscode.window.showInformationMessage("Subscription stopped");
    ctx.codeLensProvider.refresh();
  } catch (error) {
    handleError(ctx, error, "Stop subscription failed");
  }
}
