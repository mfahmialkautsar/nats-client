import * as vscode from "vscode";
import { VariableStore } from "@/services/variable-store";

export function registerVariableTree(
  context: vscode.ExtensionContext,
  store: VariableStore,
): void {
  const provider = new VariableTreeProvider(store);
  context.subscriptions.push(
    provider,
    vscode.window.registerTreeDataProvider("natsVariablesView", provider),
  );
  const subscription = store.onDidChange(() => provider.refresh());
  context.subscriptions.push(subscription);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "nats.variables.view.addEnvironment",
      async () => {
        const name = await vscode.window.showInputBox({
          prompt: "Environment name",
        });
        if (!name) {
          return;
        }
        await store.createEnvironment(name.trim());
      },
    ),
    vscode.commands.registerCommand(
      "nats.variables.view.deleteEnvironment",
      async (node: EnvironmentNode) => {
        if (!node) {
          return;
        }
        const confirmation = await vscode.window.showWarningMessage(
          `Delete environment "${node.name}"?`,
          { modal: true },
          "Delete",
        );
        if (confirmation !== "Delete") {
          return;
        }
        await store.deleteEnvironment(node.name);
      },
    ),
    vscode.commands.registerCommand(
      "nats.variables.view.setActiveEnvironment",
      async (node: EnvironmentNode) => {
        if (!node) {
          return;
        }
        await store.setActiveEnvironment(node.name);
      },
    ),
    vscode.commands.registerCommand(
      "nats.variables.view.addVariable",
      async (target?: EnvironmentNode) => {
        const environment = target?.name ?? store.activeEnvironment;
        const name = await vscode.window.showInputBox({
          prompt: "Variable name",
        });
        if (!name) {
          return;
        }
        const value = await vscode.window.showInputBox({
          prompt: "Variable value",
        });
        if (value === undefined) {
          return;
        }
        await store.set(name.trim(), value, environment);
      },
    ),
    vscode.commands.registerCommand(
      "nats.variables.view.editVariable",
      async (node: VariableNode) => {
        if (!node) {
          return;
        }
        const value = await vscode.window.showInputBox({
          prompt: `Value for ${node.key}`,
          value: node.value,
        });
        if (value === undefined) {
          return;
        }
        await store.set(node.key, value, node.environment);
      },
    ),
    vscode.commands.registerCommand(
      "nats.variables.view.deleteVariable",
      async (node: VariableNode) => {
        if (!node) {
          return;
        }
        const confirmation = await vscode.window.showWarningMessage(
          `Delete variable "${node.key}"?`,
          { modal: true },
          "Delete",
        );
        if (confirmation !== "Delete") {
          return;
        }
        await store.delete(node.key, node.environment);
      },
    ),
    vscode.commands.registerCommand(
      "nats.variables.view.copyValue",
      async (node: VariableNode) => {
        if (!node) {
          return;
        }
        await vscode.env.clipboard.writeText(node.value);
        vscode.window.showInformationMessage(`Copied value for ${node.key}`);
      },
    ),
  );
}

class VariableTreeProvider
  implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable
{
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly store: VariableStore) {}

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    if (element.type === "environment") {
      const item = new vscode.TreeItem(
        element.name,
        vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.description =
        element.name === this.store.activeEnvironment ? "active" : undefined;
      item.contextValue = "natsEnvironment";
      return item;
    }
    const item = new vscode.TreeItem(
      element.key,
      vscode.TreeItemCollapsibleState.None,
    );
    item.description = element.value;
    item.contextValue = "natsVariable";
    item.command = {
      command: "nats.variables.view.copyValue",
      title: "Copy Variable Value",
      arguments: [element],
    };
    return item;
  }

  getChildren(element?: TreeNode): vscode.ProviderResult<TreeNode[]> {
    if (!element) {
      return this.store
        .listEnvironments()
        .map((name) => ({ type: "environment", name }));
    }
    if (element.type === "environment") {
      return this.store.listVariables(element.name).map((entry) => ({
        type: "variable",
        environment: element.name,
        key: entry.key,
        value: entry.value,
      }));
    }
    return [];
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

interface EnvironmentNode {
  readonly type: "environment";
  readonly name: string;
}

interface VariableNode {
  readonly type: "variable";
  readonly environment: string;
  readonly key: string;
  readonly value: string;
}

type TreeNode = EnvironmentNode | VariableNode;
