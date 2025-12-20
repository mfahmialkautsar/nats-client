import * as vscode from "vscode";

export interface ExtensionSettings {
  requestTimeoutMs: number;
  autoRevealOutput: boolean;
}

export function readSettings(): ExtensionSettings {
  const config = vscode.workspace.getConfiguration("natsClient");
  return {
    requestTimeoutMs: config.get("requestTimeoutMs", 15000),
    autoRevealOutput: config.get("autoRevealOutput", false),
  };
}
