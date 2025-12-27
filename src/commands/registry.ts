import * as vscode from "vscode";
import type { OutputChannelRegistry } from "@/services/output-channel-registry";
import { appendLogBlock } from "@/services/log-sink";

export function registerCommand<A extends unknown[]>(
  context: vscode.ExtensionContext,
  command: string,
  channelRegistry: OutputChannelRegistry,
  callback: (...args: A) => Thenable<void> | void,
): void {
  const disposable = vscode.commands.registerCommand(
    command,
    async (...args: unknown[]) => {
      try {
        await Promise.resolve(callback(...(args as A)));
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

  const channel = channelRegistry.main();
  appendLogBlock(channel, {
    meta: { timestamp: new Date().toISOString() },
    items: [
      { title: message, body: errorMsg },
      ...(stack ? [{ title: "Stack Trace", body: stack }] : []),
    ],
  });
  channel.show(true);

  vscode.window.showErrorMessage(`${message}: ${errorMsg}`);
  console.error(message, error);
}
