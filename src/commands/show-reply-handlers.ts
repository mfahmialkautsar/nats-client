import * as vscode from "vscode";
import { CommandContext } from "./context";

export async function showReplyHandlers(ctx: CommandContext) {
  const handlers = ctx.session.listReplyHandlers();
  if (handlers.length === 0) {
    void vscode.window.showInformationMessage("No active reply handlers");
    return;
  }
  const items: vscode.QuickPickItem[] = handlers.map((h) => ({
    label: h.subject,
    description: h.server,
    detail: h.key,
  }));
  const selection = await vscode.window.showQuickPick(items, {
    placeHolder: "Select a reply handler to manage",
  });
  if (!selection) {
    return;
  }

  const actions: vscode.QuickPickItem[] = [
    { label: "Stop Reply Handler", description: "Stop the reply handler" },
    { label: "Show Output", description: "Reveal output channel" },
    { label: "Copy Subject", description: "Copy subject to clipboard" },
  ];
  const action = await vscode.window.showQuickPick(actions, {
    placeHolder: `Action for ${selection.label}`,
  });
  if (!action) {
    return;
  }
  switch (action.label) {
    case "Stop Reply Handler": {
      ctx.session.stopReplyHandler(selection.detail ?? "");
      ctx.channelRegistry.release(selection.detail ?? "");
      vscode.window.showInformationMessage(
        `Stopped reply handler for ${selection.label}`,
      );
      ctx.codeLensProvider.refresh();
      ctx.statusBar.updateConnectionCount(ctx.session.connectionCount());
      break;
    }
    case "Show Output": {
      const ch = ctx.channelRegistry.acquire(
        selection.label,
        selection.detail ?? "",
      );
      ch.show(true);
      break;
    }
    case "Copy Subject": {
      await vscode.env.clipboard.writeText(selection.label);
      vscode.window.showInformationMessage("Subject copied to clipboard");
      break;
    }
    default:
      break;
  }
}
