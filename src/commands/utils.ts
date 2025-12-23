import * as vscode from "vscode";
import {
  parseNatsDocument,
  findActionNearestLine,
} from "@/core/nats-document-parser";
import { NatsAction, NatsActionType } from "@/core/nats-actions";
import { VariableStore } from "@/services/variable-store";

import { CommandContext } from "./context";
import { readSettings } from "@/services/configuration";

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

export function revealChannel(ctx: CommandContext, channel: any) {
  const settings = readSettings();
  if (!settings.autoRevealOutput) {
    return;
  }
  const main = ctx.channelRegistry.main();
  if (channel !== main) {
    channel.show(true);
  }
}
