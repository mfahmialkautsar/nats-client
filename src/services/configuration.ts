import * as vscode from "vscode";

export interface ExtensionSettings {
  requestTimeoutMs: number;
}

export function readSettings(): ExtensionSettings {
  const config = vscode.workspace.getConfiguration("natsClient");
  return {
    requestTimeoutMs: config.get("requestTimeoutMs", 15000),
  };
}
