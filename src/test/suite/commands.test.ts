import assert from "node:assert";
import path from "node:path";
import { suite, test } from "mocha";
import * as vscode from "vscode";

suite("NATS Client VS Code integration", () => {
  test("activates extension and registers commands", async () => {
    const extension = vscode.extensions.getExtension(
      "mfahmialkautsar.nats-client",
    );
    assert.ok(extension, "Expected extension to be installed");
    await extension.activate();
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("nats.showOutput"));
    assert.ok(commands.includes("nats.connections.menu"));
  });

  test("formats .nats documents via registered provider", async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder, "Workspace folder was not opened");
    const docUri = vscode.Uri.file(
      path.join(workspaceFolder.uri.fsPath, "pub-sub.nats"),
    );
    const document = await vscode.workspace.openTextDocument(docUri);
    const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
      "vscode.executeFormatDocumentProvider",
      document.uri,
      { insertSpaces: true, tabSize: 2 },
    );
    assert.ok(edits && edits.length > 0, "Expected formatter to produce edits");
  });
});
