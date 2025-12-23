import * as vscode from "vscode";
import { VariableStore } from "@/services/variable-store";

export class VariableHoverProvider implements vscode.HoverProvider {
  constructor(private readonly variableStore: VariableStore) {}

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.Hover> {
    const range = document.getWordRangeAtPosition(position, /\{\{[^}]+\}\}/);
    if (!range) {
      return undefined;
    }

    const text = document.getText(range);
    // Extract variable name from {{name}}
    const match = text.match(/\{\{([^}]+)\}\}/);
    if (!match) {
      return undefined;
    }

    const variableName = match[1].trim();

    const globalValue = this.variableStore.get(variableName);
    if (globalValue !== undefined) {
      return new vscode.Hover(
        new vscode.MarkdownString(
          `**Global Variable**\n\n\`${variableName}\` = \`${globalValue}\``,
        ),
      );
    }

    const docText = document.getText();
    const localVarRegex = new RegExp(`^@${variableName}\\s*=\\s*(.*)$`, "m");
    const localMatch = docText.match(localVarRegex);

    if (localMatch) {
      const localValue = localMatch[1].trim();
      return new vscode.Hover(
        new vscode.MarkdownString(
          `**Local Variable**\n\n\`${variableName}\` = \`${localValue}\``,
        ),
      );
    }

    return undefined;
  }
}
