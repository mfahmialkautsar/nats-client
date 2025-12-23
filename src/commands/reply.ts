import * as vscode from "vscode";
import { CommandContext } from "./context";
import { resolveAction, resolveServer, revealChannel } from "./utils";
import { buildKey } from "@/features/code-lens/nats-code-lens-provider";

export async function startReplyHandler(
  ctx: CommandContext,
  filePath: string,
  line: number,
) {
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
  const server = resolveServer(action.server, ctx.variableStore);
  if (!server) {
    vscode.window.showErrorMessage(
      "REPLY block must specify a server (inline or via NATS-Server header)",
    );
    return;
  }
  const key = buildKey(filePath, line);
  const subject = ctx.variableStore.resolveText(action.subject);
  const headers = ctx.variableStore.resolveRecord(action.headers);
  const channel = ctx.channelRegistry.acquire(`Reply:${subject}`, key);
  try {
    const template = ctx.variableStore.resolveOptional(action.template);
    const payload = ctx.variableStore.resolveOptional(action.data);
    await ctx.session.startReplyHandler(
      server,
      subject,
      template,
      payload,
      channel,
      key,
      headers,
    );
    revealChannel(ctx, channel);
    vscode.window.showInformationMessage(
      `Reply handler started for ${subject}`,
    );
    ctx.statusBar.updateConnectionCount(ctx.session.connectionCount());
  } catch (error) {
    ctx.channelRegistry.release(key);
    throw error;
  }
  ctx.codeLensProvider.refresh();
}

export function stopReplyHandler(
  ctx: CommandContext,
  filePath: string,
  line: number,
) {
  const key = buildKey(filePath, line);
  ctx.session.stopReplyHandler(key);
  ctx.channelRegistry.release(key);
  vscode.window.showInformationMessage("Reply handler stopped");
  ctx.codeLensProvider.refresh();
}
