import * as vscode from "vscode";
import type { CommandContext } from "./context";
import {
  handleError,
  resolveAction,
  resolveServer,
  revealIfNew,
} from "./utils";
import { CompositeLogSink } from "@/services/log-sink";
import { AckPolicy } from "nats";

async function resolveConsumeContext(
  ctx: CommandContext,
  filePath: string,
  line: number,
) {
  const action = await resolveAction(filePath, line, "jetstreamConsume");
  if (!action) {
    vscode.window.showErrorMessage("JSCONSUME action not found on this line");
    return null;
  }

  const server = resolveServer(action.server, ctx.variableStore);
  if (!server) {
    vscode.window.showErrorMessage("JSCONSUME block must specify a server");
    return null;
  }

  const stream = action.stream
    ? ctx.variableStore.resolveText(action.stream)
    : undefined;
  const durable = action.durable
    ? ctx.variableStore.resolveText(action.durable)
    : undefined;

  if (!stream || !durable) {
    vscode.window.showErrorMessage(
      "JSCONSUME requires stream and durable consumer name",
    );
    return null;
  }

  const key = `${server}|${stream}/${durable}`;
  return { server, stream, durable, key };
}

export async function startJetStreamConsume(
  ctx: CommandContext,
  filePath: string,
  line: number,
) {
  const context = await resolveConsumeContext(ctx, filePath, line);
  if (!context) {
    return;
  }
  const { server, stream, durable, key } = context;

  if (ctx.session.isSubscribed(key)) {
    vscode.window.showInformationMessage(
      `Already consuming from ${stream}/${durable}`,
    );
    return;
  }

  try {
    const jsm = await ctx.session.getJetStreamManager(server);
    try {
      await jsm.streams.info(stream);
    } catch {
      await jsm.streams.add({
        name: stream,
      });
    }

    try {
      await jsm.consumers.info(stream, durable);
    } catch {
      await jsm.consumers.add(stream, {
        durable_name: durable,
        ack_policy: AckPolicy.Explicit,
      });
    }

    const channelName = `JS: ${stream}/${durable}`;

    const { channel, isNew } = ctx.channelRegistry.acquire(channelName, key);
    const main = ctx.channelRegistry.main();
    const sink = new CompositeLogSink([main, channel]);
    await ctx.session.subscribeJetStream(
      server,
      stream,
      durable,
      undefined,
      sink,
      key,
    );
    revealIfNew(ctx, channel, isNew);
    vscode.window.showInformationMessage(
      `Started JetStream consumption from ${channelName}`,
    );
    ctx.statusBar.updateConnectionCount(ctx.session.connectionCount());
    ctx.codeLensProvider.refresh();
  } catch (error) {
    // Release the channel if subscription failed
    ctx.channelRegistry.release(key);
    handleError(
      ctx,
      error,
      "JetStream Consume failed",
      server,
      `${stream}/${durable}`,
    );
  }
}

export async function stopJetStreamConsume(
  ctx: CommandContext,
  filePath: string,
  line: number,
) {
  const context = await resolveConsumeContext(ctx, filePath, line);
  if (!context) {
    return;
  }
  const { stream, durable, key } = context;

  if (!ctx.session.isSubscribed(key)) {
    return;
  }

  ctx.session.stopSubscription(key);
  ctx.channelRegistry.release(key);
  vscode.window.showInformationMessage(
    `Stopped JetStream consumption from ${stream}/${durable}`,
  );
  ctx.statusBar.updateConnectionCount(ctx.session.connectionCount());
  ctx.codeLensProvider.refresh();
}
