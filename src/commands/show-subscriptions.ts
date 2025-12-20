import * as vscode from "vscode";
import { CommandContext } from "./context";

export async function showSubscriptions(ctx: CommandContext) {
  const subs = ctx.session.listSubscriptions();
  if (subs.length === 0) {
    void vscode.window.showInformationMessage("No active subscriptions");
    return;
  }
  const items: vscode.QuickPickItem[] = subs.map((s) => ({
    label: s.subject,
    description: s.server,
    detail: s.key,
  }));
  const selection = await vscode.window.showQuickPick(items, {
    placeHolder: "Select a subscription to manage",
  });
  if (!selection) {
    return;
  }

  const actions: vscode.QuickPickItem[] = [
    { label: "Unsubscribe", description: "Stop the subscription" },
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
    case "Unsubscribe": {
      ctx.session.stopSubscription(selection.detail ?? "");
      ctx.channelRegistry.release(selection.detail ?? "");
      vscode.window.showInformationMessage(
        `Unsubscribed from ${selection.label}`,
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
