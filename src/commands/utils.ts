import * as vscode from "vscode";
import {
  parseNatsDocument,
  findActionNearestLine,
} from "@/core/nats-document-parser";
import { NatsAction, NatsActionType } from "@/core/nats-actions";
import { VariableStore } from "@/services/variable-store";

export async function resolveAction(
  filePath: string,
  line: number,
  type: NatsActionType,
): Promise<NatsAction | undefined> {
  const document = await vscode.workspace.openTextDocument(
    vscode.Uri.file(filePath),
  );
  const actions = parseNatsDocument(document.getText());
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
