import * as vscode from "vscode";
import type { CommandContext } from "./context";
import {
  handleError,
  resolveAction,
  resolveServer,
  revealIfNew,
} from "./utils";
import { readSettings } from "@/services/configuration";
import { appendLogBlock } from "@/services/log-sink";

export async function sendRequest(
  ctx: CommandContext,
  filePath: string,
  line: number,
) {
  const action = await resolveAction(filePath, line, "request");
  if (!action) {
    vscode.window.showErrorMessage("REQUEST action not found on this line");
    return;
  }
  const server = resolveServer(action.server, ctx.variableStore);
  if (!server) {
    vscode.window.showErrorMessage(
      "REQUEST block must specify a server (inline or via NATS-Server header)",
    );
    return;
  }
  const subject = ctx.variableStore.resolveText(action.subject);
  const payload = ctx.variableStore.resolveOptional(action.data) ?? "";
  const headers = ctx.variableStore.resolveRecord(action.headers);
  const settings = readSettings();

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Sending request to ${subject}...`,
      cancellable: false,
    },
    async () => {
      try {
        const result = await ctx.session.sendRequest(
          server,
          subject,
          payload,
          { timeoutMs: action.timeoutMs ?? settings.requestTimeoutMs },
          headers,
        );
        const mainChannel = ctx.channelRegistry.main();
        const { channel, isNew } = ctx.channelRegistry.getOrCreate(subject);
        appendLogBlock(mainChannel, result);
        appendLogBlock(channel, result);
        revealIfNew(ctx, channel, isNew);
        ctx.statusBar.updateConnectionCount(ctx.session.connectionCount());
        vscode.window.showInformationMessage(`Request sent to ${subject}`);
      } catch (error) {
        handleError(ctx, error, "Request failed", server, subject);
      }
    },
  );
}
