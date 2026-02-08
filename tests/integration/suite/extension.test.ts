import * as assert from "node:assert";
import * as vscode from "vscode";

suite("Extension Test Suite", () => {
  vscode.window.showInformationMessage("Start all tests.");

  test("Extension should be present", () => {
    assert.ok(vscode.extensions.getExtension("mfahmialkautsar.nats-client"));
  });

  test("Extension should activate", async () => {
    const extension = vscode.extensions.getExtension(
      "mfahmialkautsar.nats-client",
    );
    assert.ok(extension);
    if (!extension.isActive) {
      await extension.activate();
    }
    assert.ok(extension.isActive);
  });

  test("Commands should be registered", async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("nats.startSubscription"));
    assert.ok(commands.includes("nats.publish"));
    assert.ok(commands.includes("nats.variables.view.addEnvironment"));
  });

  test("Variable completion should work", async () => {
    if (!vscode.workspace.workspaceFolders) {
      throw new Error("No workspace folder found");
    }
    const workspaceUri = vscode.workspace.workspaceFolders[0].uri;
    const docUri = vscode.Uri.joinPath(workspaceUri, "jetstream.nats");
    const doc = await vscode.workspace.openTextDocument(docUri);

    const editor = await vscode.window.showTextDocument(doc);
    const lastLine = doc.lineCount - 1;
    const newPos = new vscode.Position(lastLine + 1, 0);

    await editor.edit((edit) => {
      edit.insert(newPos, "\n{{");
    });

    const position = new vscode.Position(lastLine + 1, 2);
    const list = await vscode.commands.executeCommand<vscode.CompletionList>(
      "vscode.executeCompletionItemProvider",
      doc.uri,
      position,
    );

    assert.ok(list);
    assert.ok(list.items.length > 0);
    const item = list.items.find((i) => i.label === "url");
    assert.ok(item, "Should find local variable 'url'");
  });
});
