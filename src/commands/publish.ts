import * as vscode from "vscode";
import { CommandContext } from "./context";
import { resolveAction, resolveServer } from "./utils";
import { readSettings } from "@/services/configuration";
import { appendLogBlock } from "@/services/log-sink";

export async function publish(
  ctx: CommandContext,
  filePath: string,
  line: number,
) {
  const action = await resolveAction(filePath, line, "publish");
  if (!action) {
    vscode.window.showErrorMessage("PUBLISH action not found on this line");
    return;
  }
  const server = resolveServer(action.server, ctx.variableStore);
  if (!server) {
    vscode.window.showErrorMessage(
      "PUBLISH block must specify a server (inline or via NATS-Server header)",
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
      title: `Publishing to ${subject}...`,
      cancellable: false,
    },
    async () => {
      try {
        const result = await ctx.session.publish(
          server,
          subject,
          payload,
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
    vscode.window.showInformationMessage(`Published to ${result.subject}`);
  } else {
    vscode.window.showErrorMessage(
      `Publish to ${result.subject} failed: ${result.error}`,
    );
  }
}
