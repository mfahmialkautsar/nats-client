import * as vscode from "vscode";
import type { CommandContext } from "./context";
import {
  handleError,
  resolveAction,
  resolveServer,
  revealIfNew,
} from "./utils";
import { appendLogBlock } from "@/services/log-sink";

export async function jetstreamPublish(
  ctx: CommandContext,
  filePath: string,
  line: number,
) {
  const action = await resolveAction(filePath, line, "jetstreamPublish");
  if (!action) {
    vscode.window.showErrorMessage("JSPUBLISH action not found on this line");
    return;
  }

  const server = resolveServer(action.server, ctx.variableStore);
  if (!server) {
    vscode.window.showErrorMessage("JSPUBLISH block must specify a server");
    return;
  }

  const subject = ctx.variableStore.resolveText(action.subject);
  const stream = action.stream
    ? ctx.variableStore.resolveText(action.stream)
    : undefined;
  const payload = ctx.variableStore.resolveOptional(action.data) ?? "";
  const headers = ctx.variableStore.resolveRecord(action.headers);

  try {
    if (stream) {
      const jsm = await ctx.session.getJetStreamManager(server);
      try {
        await jsm.streams.info(stream);
      } catch {
        await jsm.streams.add({ name: stream, subjects: [subject] });
      }
    }

    const result = await ctx.session.publishJetStream(
      server,
      stream,
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
    vscode.window.showInformationMessage(`JetStream Published to ${subject}`);
  } catch (error) {
    handleError(ctx, error, "JetStream Publish failed", server, subject);
  }
}
