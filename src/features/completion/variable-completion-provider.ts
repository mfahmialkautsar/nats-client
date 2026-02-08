import * as vscode from "vscode";
import type { VariableStore } from "@/services/variable-store";

export class VariableCompletionProvider
  implements vscode.CompletionItemProvider
{
  constructor(private readonly variableStore: VariableStore) {}

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
    _context: vscode.CompletionContext,
  ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
    const { text: lineText } = document.lineAt(position);
    const prefix = lineText.substring(0, position.character);

    // Check if we are inside a variable placeholder {{...}}
    // Simple regex check: look for {{ followed by non-} characters
    const match = /\{\{([\w.-]*)$/.exec(prefix);
    if (!match) {
      return undefined;
    }

    const items: vscode.CompletionItem[] = [];
    const globalVariables = this.variableStore.getAllVariables();

    for (const [key, value] of Object.entries(globalVariables)) {
      const item = new vscode.CompletionItem(
        key,
        vscode.CompletionItemKind.Variable,
      );
      item.detail = value;
      item.documentation = new vscode.MarkdownString(
        `Global variable: \`${key}\` = \`${value}\``,
      );
      items.push(item);
    }

    const text = document.getText();
    const localVarRegex = /^@([\w-]+)[ \t]*=(.*)$/gm;
    let m;
    while ((m = localVarRegex.exec(text)) !== null) {
      const key = m[1];
      const value = m[2].trim();
      const item = new vscode.CompletionItem(
        key,
        vscode.CompletionItemKind.Variable,
      );
      item.detail = value;
      item.documentation = new vscode.MarkdownString(
        `Local variable: \`${key}\` = \`${value}\``,
      );
      items.push(item);
    }

    return items;
  }
}
