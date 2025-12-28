import * as vscode from "vscode";
import type { CommandContext } from "./context";
import { handleError } from "./utils";
import type { SavedConnection } from "@/services/nats-session";

export async function connectionsMenu(ctx: CommandContext) {
  try {
    const savedConnections = ctx.session.getSavedConnections();
    const activeConnections = ctx.session.listConnections();

    const items: vscode.QuickPickItem[] = [
      {
        label: "$(add) Add Connection",
        description: "Save a new connection profile",
        detail: "add-connection",
      },
      {
        label: "$(sync) Reset all connections",
        description: "Close and clear all active connections",
        detail: "reset-all",
      },
    ];

    if (savedConnections.length > 0) {
      items.push({
        label: "Saved Connections",
        kind: vscode.QuickPickItemKind.Separator,
      });
      for (const conn of savedConnections) {
        const isActive = ctx.session.isConnectionActive(conn.serverUrl);
        items.push({
          label: `${isActive ? "$(check)" : "$(circle-slash)"} ${conn.name}`,
          description: conn.serverUrl,
          detail: `saved:${conn.name}`,
        });
      }
    }

    // Also show active connections that are NOT in saved list (ad-hoc)
    const adHocConnections = activeConnections.filter((c) => {
      return !savedConnections.some((s) => s.serverUrl === c.url);
    });

    if (adHocConnections.length > 0) {
      items.push({
        label: "Ad-hoc Connections",
        kind: vscode.QuickPickItemKind.Separator,
      });
      for (const conn of adHocConnections) {
        items.push({
          label: `$(check) ${conn.server}`,
          description: "Active (Not Saved)",
          detail: `active:${conn.server}`,
        });
      }
    }

    const selection = await vscode.window.showQuickPick(items, {
      placeHolder: "Manage NATS connections",
    });

    if (!selection) {
      return;
    }

    if (selection.detail === "add-connection") {
      await addConnection(ctx);
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

    if (selection.detail?.startsWith("saved:")) {
      const name = selection.detail.substring(6);
      const conn = savedConnections.find((c) => c.name === name);
      if (conn) {
        await manageSavedConnection(ctx, conn);
      }
      return;
    }

    if (selection.detail?.startsWith("active:")) {
      const server = selection.detail.substring(7);
      const conn = activeConnections.find((c) => c.server === server);
      if (conn) {
        const action = await vscode.window.showQuickPick(
          [{ label: "Disconnect", description: "Close connection" }],
          { placeHolder: `Action for ${server}` },
        );
        if (action?.label === "Disconnect") {
          ctx.session.markConnectionClosed(server);
          ctx.statusBar.updateConnectionCount(ctx.session.connectionCount());
          vscode.window.showInformationMessage(`Disconnected from ${server}`);
        }
      }
      return;
    }
  } catch (error) {
    handleError(ctx, error, "Connections menu error");
  }
}

async function addConnection(ctx: CommandContext) {
  const name = await vscode.window.showInputBox({
    prompt: "Connection Name",
    placeHolder: "Local NATS",
  });
  if (!name) {
    return;
  }
  const url = await vscode.window.showInputBox({
    prompt: "Server URL",
    placeHolder: "nats://localhost:4222",
    value: "nats://localhost:4222",
  });
  if (!url) {
    return;
  }

  await ctx.session.saveConnection({ name, serverUrl: url });
  vscode.window.showInformationMessage(`Connection '${name}' saved.`);
  // Re-open menu
  connectionsMenu(ctx);
}

async function manageSavedConnection(
  ctx: CommandContext,
  conn: SavedConnection,
) {
  const isActive = ctx.session.isConnectionActive(conn.serverUrl);

  const items: vscode.QuickPickItem[] = [];

  if (isActive) {
    items.push({ label: "$(plug) Disconnect", detail: "disconnect" });
  } else {
    items.push({ label: "$(plug) Connect", detail: "connect" });
  }
  items.push({ label: "$(edit) Edit", detail: "edit" });
  items.push({ label: "$(trash) Delete", detail: "delete" });

  const selection = await vscode.window.showQuickPick(items, {
    placeHolder: `Manage '${conn.name}'`,
  });
  if (!selection) {
    return;
  }

  if (selection.detail === "connect") {
    try {
      await ctx.session.connect(conn.serverUrl);
      ctx.statusBar.updateConnectionCount(ctx.session.connectionCount());
      vscode.window.showInformationMessage(`Connected to ${conn.name}`);
    } catch (e) {
      handleError(ctx, e, `Failed to connect to ${conn.name}`);
    }
  } else if (selection.detail === "disconnect") {
    const activeConn = ctx.session
      .listConnections()
      .find((c) => c.url === conn.serverUrl);
    if (activeConn) {
      ctx.session.markConnectionClosed(activeConn.server);
      ctx.statusBar.updateConnectionCount(ctx.session.connectionCount());
      vscode.window.showInformationMessage(`Disconnected from ${conn.name}`);
    }
  } else if (selection.detail === "edit") {
    const name = await vscode.window.showInputBox({
      prompt: "Connection Name",
      value: conn.name,
    });
    if (!name) {
      return;
    }
    const url = await vscode.window.showInputBox({
      prompt: "Server URL",
      value: conn.serverUrl,
    });
    if (!url) {
      return;
    }

    if (name !== conn.name) {
      await ctx.session.deleteConnection(conn.name);
    }
    await ctx.session.saveConnection({ name, serverUrl: url });
    vscode.window.showInformationMessage(`Connection '${name}' updated.`);
  } else if (selection.detail === "delete") {
    const confirm = await vscode.window.showWarningMessage(
      `Are you sure you want to delete '${conn.name}'?`,
      { modal: true },
      "Delete",
    );
    if (confirm === "Delete") {
      await ctx.session.deleteConnection(conn.name);
      vscode.window.showInformationMessage(
        `Connection '${conn.name}' deleted.`,
      );
    }
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
