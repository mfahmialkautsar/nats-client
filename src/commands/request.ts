import * as vscode from "vscode";
import { CommandContext } from "./context";
import { resolveAction, resolveServer } from "./utils";
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

  const result = await vscode.window.withProgress(
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
        appendLogBlock(mainChannel, result);
        if (settings.autoRevealOutput) {
          mainChannel.show(true);
        }
        ctx.statusBar.updateConnectionCount(ctx.session.connectionCount());
        return { success: true, subject };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (
          errorMsg.includes("DISCONNECT") ||
          errorMsg.includes("CONNECTION")
        ) {
          const connInfo = ctx.session
            .listConnections()
            .find((c) => c.url === server);
          if (connInfo) {
            ctx.session.markConnectionClosed(connInfo.server);
          }
        }
        ctx.statusBar.updateConnectionCount(ctx.session.connectionCount());
        return { success: false, subject, error: errorMsg };
      }
    },
  );

  if (result.success) {
    vscode.window.showInformationMessage(`Request sent to ${result.subject}`);
  } else {
    vscode.window.showErrorMessage(
      `Request to ${result.subject} failed: ${result.error}`,
    );
  }
}
