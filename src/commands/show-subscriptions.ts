import * as vscode from "vscode";
import type { CommandContext } from "./context";
import { handleError } from "./utils";

export async function showSubscriptions(ctx: CommandContext) {
  try {
    const subs = ctx.session.listSubscriptions();
    if (subs.length === 0) {
      void vscode.window.showInformationMessage("No active subscriptions");
      return;
    }
    const items: vscode.QuickPickItem[] = subs.map(
      ({ subject, server, key }) => ({
        label: subject,
        description: server,
        detail: key,
      }),
    );
    const selection = await vscode.window.showQuickPick(items, {
      placeHolder: "Select a subscription to manage",
    });
    if (!selection) {
      return;
    }

    const { label, detail } = selection;

    const actions: vscode.QuickPickItem[] = [
      { label: "Unsubscribe", description: "Stop the subscription" },
      { label: "Show Output", description: "Reveal output channel" },
      { label: "Copy Subject", description: "Copy subject to clipboard" },
    ];
    const action = await vscode.window.showQuickPick(actions, {
      placeHolder: `Action for ${label}`,
    });
    if (!action) {
      return;
    }
    switch (action.label) {
      case "Unsubscribe": {
        ctx.session.stopSubscription(detail ?? "");
        ctx.channelRegistry.release(detail ?? "");
        vscode.window.showInformationMessage(`Unsubscribed from ${label}`);
        ctx.codeLensProvider.refresh();
        ctx.statusBar.updateConnectionCount(ctx.session.connectionCount());
        break;
      }
      case "Show Output": {
        const { channel } = ctx.channelRegistry.acquire(label, detail ?? "");
        channel.show(true);
        break;
      }
      case "Copy Subject": {
        await vscode.env.clipboard.writeText(label);
        vscode.window.showInformationMessage("Subject copied to clipboard");
        break;
      }
      default:
        break;
    }
  } catch (error) {
    handleError(ctx, error, "Show subscriptions error");
  }
}
