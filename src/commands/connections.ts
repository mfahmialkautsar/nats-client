import * as vscode from "vscode";
import { CommandContext } from "./context";

export async function connectionsMenu(ctx: CommandContext) {
  const connections = ctx.session.listConnections();
  if (connections.length === 0) {
    vscode.window.showInformationMessage("No active connections");
    return;
  }

  const subscriptions = ctx.session.listSubscriptions();
  const replyHandlers = ctx.session.listReplyHandlers();

  const items: vscode.QuickPickItem[] = [
    {
      label: "$(sync) Reset all connections",
      description: "Close and clear all connections",
      detail: "reset-all",
    },
    { label: "", kind: vscode.QuickPickItemKind.Separator },
    ...connections.map((conn) => {
      const statusIcon =
        conn.status === "connected" ? "$(check)" : "$(circle-slash)";
      const statusText = conn.status === "connected" ? "Connected" : "Closed";

      const connSubs = subscriptions.filter((s) => s.server === conn.server);
      const connReplies = replyHandlers.filter((r) => r.server === conn.server);
      const handlerCount = connSubs.length + connReplies.length;
      const handlerText = handlerCount > 0 ? ` (${handlerCount} active)` : "";

      return {
        label: `${statusIcon} ${conn.server}${handlerText}`,
        description: statusText,
        detail: conn.server,
      };
    }),
  ];

  if (subscriptions.length > 0) {
    items.push({ label: "", kind: vscode.QuickPickItemKind.Separator });
    items.push({
      label: `$(list-ordered) Subscriptions (${subscriptions.length})`,
      description: "",
      detail: "subscriptions-header",
    });
    for (const sub of subscriptions) {
      items.push({
        label: `  ${sub.subject}`,
        description: sub.server,
        detail: `sub:${sub.key}`,
      });
    }
  }

  if (replyHandlers.length > 0) {
    items.push({ label: "", kind: vscode.QuickPickItemKind.Separator });
    items.push({
      label: `$(comment) Reply Handlers (${replyHandlers.length})`,
      description: "",
      detail: "replies-header",
    });
    for (const reply of replyHandlers) {
      items.push({
        label: `  ${reply.subject}`,
        description: reply.server,
        detail: `reply:${reply.key}`,
      });
    }
  }

  const selection = await vscode.window.showQuickPick(items, {
    placeHolder: "Manage NATS connections",
  });

  if (!selection) {
    return;
  }

  if (selection.detail === "reset-all") {
    await ctx.session.reset();
    ctx.channelRegistry.disposeAll();
    ctx.codeLensProvider.refresh();
    ctx.statusBar.updateConnectionCount(ctx.session.connectionCount());
    vscode.window.showInformationMessage(
      "All NATS connections have been reset",
    );
    return;
  }

  if (selection.detail?.startsWith("sub:")) {
    const key = selection.detail.substring(4);
    const sub = subscriptions.find((s) => s.key === key);
    if (!sub) {
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Stop subscription to ${sub.subject}?`,
      { modal: true },
      "Stop",
    );

    if (confirm !== "Stop") {
      return;
    }

    ctx.session.stopSubscription(key);
    ctx.channelRegistry.release(key);
    vscode.window.showInformationMessage(
      `Stopped subscription: ${sub.subject}`,
    );
    ctx.codeLensProvider.refresh();
    ctx.statusBar.updateConnectionCount(ctx.session.connectionCount());
    return;
  }

  if (selection.detail?.startsWith("reply:")) {
    const key = selection.detail.substring(6);
    const reply = replyHandlers.find((r) => r.key === key);
    if (!reply) {
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Stop reply handler for ${reply.subject}?`,
      { modal: true },
      "Stop",
    );

    if (confirm !== "Stop") {
      return;
    }

    ctx.session.stopReplyHandler(key);
    ctx.channelRegistry.release(key);
    vscode.window.showInformationMessage(
      `Stopped reply handler: ${reply.subject}`,
    );
    ctx.codeLensProvider.refresh();
    ctx.statusBar.updateConnectionCount(ctx.session.connectionCount());
    return;
  }

  if (
    selection.detail === "subscriptions-header" ||
    selection.detail === "replies-header"
  ) {
    return;
  }

  const serverKey = selection.detail ?? "";
  const status = ctx.session.getConnectionStatus(serverKey);

  if (status === "disconnected") {
    const action = await vscode.window.showQuickPick(
      [
        {
          label: "$(plug) Reconnect",
          description: "Reconnect and restart all subscriptions/handlers",
        },
      ],
      {
        placeHolder: `Reconnect ${serverKey}?`,
      },
    );

    if (!action) {
      return;
    }

    try {
      const restartedCount = await ctx.session.reconnectConnection(serverKey);
      const handlersMsg =
        restartedCount > 0
          ? ` Restarted ${restartedCount} subscription(s)/handler(s).`
          : "";
      vscode.window.showInformationMessage(
        `Reconnected to ${serverKey}.${handlersMsg}`,
      );
      ctx.statusBar.updateConnectionCount(ctx.session.connectionCount());
      ctx.codeLensProvider.refresh();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Failed to reconnect: ${errorMsg}`);
      ctx.statusBar.updateConnectionCount(ctx.session.connectionCount());
    }
  }
}

export async function resetConnections(ctx: CommandContext) {
  await ctx.session.reset();
  ctx.channelRegistry.disposeAll();
  ctx.codeLensProvider.refresh();
  ctx.statusBar.updateConnectionCount(ctx.session.connectionCount());
  vscode.window.showInformationMessage("All NATS connections have been reset");
}
