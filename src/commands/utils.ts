import * as vscode from "vscode";
import {
  parseNatsDocument,
  findActionNearestLine,
} from "@/core/nats-document-parser";
import { NatsAction, NatsActionType } from "@/core/nats-actions";
import { VariableStore } from "@/services/variable-store";
import { appendLogBlock } from "@/services/log-sink";

import { CommandContext } from "./context";

export async function resolveAction(
  filePath: string,
  line: number,
  type: NatsActionType,
  variableStore?: VariableStore,
): Promise<NatsAction | undefined> {
  const document = await vscode.workspace.openTextDocument(
    vscode.Uri.file(filePath),
  );
  const globalVariables = variableStore?.getAllVariables() ?? {};
  const actions = parseNatsDocument(document.getText(), globalVariables);
  return findActionNearestLine(actions, line - 1, type);
}

export function resolveServer(
  value: string | undefined,
  variableStore: VariableStore,
): string | undefined {
  if (!value) {
    return undefined;
  }
  const resolved = variableStore.resolveText(value);
  return resolved.trim().length > 0 ? resolved : undefined;
}

export function revealIfNew(ctx: CommandContext, channel: any, isNew: boolean) {
  if (isNew) {
    channel.show(true);
  }
}

export function handleError(
  ctx: CommandContext,
  error: unknown,
  title: string,
  server?: string,
  subject?: string,
) {
  const errorMsg = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  const mainChannel = ctx.channelRegistry.main();
  appendLogBlock(mainChannel, {
    meta: {
      timestamp: new Date().toISOString(),
      ...(server && { connection: server }),
      ...(subject && { subject }),
    },
    items: [
      { title, body: errorMsg },
      ...(stack ? [{ title: "Stack Trace", body: stack }] : []),
    ],
  });
  mainChannel.show(true);

  vscode.window.showErrorMessage(`${title}: ${errorMsg}`);

  if (server) {
    if (errorMsg.includes("DISCONNECT") || errorMsg.includes("CONNECTION")) {
      const connInfo = ctx.session
        .listConnections()
        .find((c) => c.url === server);
      if (connInfo) {
        ctx.session.markConnectionClosed(connInfo.server);
      }
    }
  }
  ctx.statusBar.updateConnectionCount(ctx.session.connectionCount());
}
