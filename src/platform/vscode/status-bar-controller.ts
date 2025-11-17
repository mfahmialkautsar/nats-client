import * as vscode from "vscode";

const STATUS_PREFIX = "NATS";

export class StatusBarController {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
    );
    this.item.command = "nats.connections.menu";
    this.updateConnectionCount(0);
    this.item.show();
  }

  updateConnectionCount(count: number): void {
    const label = count === 1 ? "connection" : "connections";
    this.item.text = `${STATUS_PREFIX}: ${count} ${label}`;
    this.item.tooltip = "Manage NATS connections";
  }

  dispose(): void {
    this.item.dispose();
  }
}
