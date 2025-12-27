import * as vscode from "vscode";
import type { CommandContext } from "./context";
import { handleError } from "./utils";

export async function connectionsMenu(ctx: CommandContext) {
  try {
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
        const connReplies = replyHandlers.filter(
          (r) => r.server === conn.server,
        );
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
      if (confirm === "Stop") {
        ctx.session.stopSubscription(key);
        ctx.channelRegistry.release(key);
        ctx.codeLensProvider.refresh();
        ctx.statusBar.updateConnectionCount(ctx.session.connectionCount());
        vscode.window.showInformationMessage(
          `Stopped subscription to ${sub.subject}`,
        );
      }
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
      if (confirm === "Stop") {
        ctx.session.stopReplyHandler(key);
        ctx.channelRegistry.release(key);
        ctx.codeLensProvider.refresh();
        ctx.statusBar.updateConnectionCount(ctx.session.connectionCount());
        vscode.window.showInformationMessage(
          `Stopped reply handler for ${reply.subject}`,
        );
      }
      return;
    }

    // If it's a connection
    const conn = connections.find((c) => c.server === selection.detail);
    if (conn) {
      const actions: vscode.QuickPickItem[] = [
        { label: "Show Output", description: "Reveal output channel" },
      ];
      if (conn.status === "connected") {
        actions.push({
          label: "Close Connection",
          description: "Disconnect from server",
        });
      }

      const action = await vscode.window.showQuickPick(actions, {
        placeHolder: `Action for ${conn.server}`,
      });

      if (action?.label === "Show Output") {
        ctx.channelRegistry.main().show(true);
      } else if (action?.label === "Close Connection") {
        ctx.session.markConnectionClosed(conn.server);
        ctx.statusBar.updateConnectionCount(ctx.session.connectionCount());
        vscode.window.showInformationMessage(
          `Closed connection to ${conn.server}`,
        );
      }
    }
  } catch (error) {
    handleError(ctx, error, "Connections menu error");
  }
}

export async function resetConnections(ctx: CommandContext) {
  try {
    await ctx.session.reset();
    ctx.channelRegistry.disposeAll();
    ctx.codeLensProvider.refresh();
    ctx.statusBar.updateConnectionCount(ctx.session.connectionCount());
    vscode.window.showInformationMessage(
      "All NATS connections have been reset",
    );
  } catch (error) {
    handleError(ctx, error, "Reset connections failed");
  }
}
