import * as vscode from "vscode";
import { CommandContext } from "./context";
import {
  handleError,
  resolveAction,
  resolveServer,
  revealIfNew,
} from "./utils";
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

  await vscode.window.withProgress(
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
        const { channel, isNew } = ctx.channelRegistry.getOrCreate(subject);
        appendLogBlock(mainChannel, result);
        appendLogBlock(channel, result);
        revealIfNew(ctx, channel, isNew);
        ctx.statusBar.updateConnectionCount(ctx.session.connectionCount());
        vscode.window.showInformationMessage(`Published to ${subject}`);
      } catch (error) {
        handleError(ctx, error, "Publish failed", server, subject);
      }
    },
  );
}
