import * as vscode from "vscode";
import { OutputChannelRegistry } from "@/services/output-channel-registry";
import { appendLogBlock } from "@/services/log-sink";

export function registerCommand(
  context: vscode.ExtensionContext,
  command: string,
  channelRegistry: OutputChannelRegistry,
  callback: (...args: any[]) => Thenable<void> | void,
): void {
  const disposable = vscode.commands.registerCommand(
    command,
    async (...args: any[]) => {
      try {
        await Promise.resolve(callback(...args));
      } catch (error) {
        reportError(channelRegistry, error, `Command ${command} failed`);
      }
    },
  );
  context.subscriptions.push(disposable);
}

function reportError(
  channelRegistry: OutputChannelRegistry,
  error: unknown,
  message: string,
): void {
  const errorMsg = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  vscode.window.showErrorMessage(`${message}: ${errorMsg}`);

  const channel = channelRegistry.main();
  const meta = { timestamp: new Date().toISOString() };
  const items = [
    { title: "ERROR", body: message },
    { title: "Message", body: errorMsg },
  ];
  if (stack) {
    items.push({ title: "Stack trace", body: stack });
  }
  appendLogBlock(channel, { meta, items }, "");
  console.error(message, error);
}
