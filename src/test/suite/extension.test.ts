import * as assert from "assert";
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
    assert.ok(commands.includes("nats.jetstreamPublish"));
    assert.ok(commands.includes("nats.jetstreamSubscribe"));
    assert.ok(commands.includes("nats.variables.view.addEnvironment"));
  });

  test("Variable completion should work", async () => {
    const doc = await vscode.workspace.openTextDocument({
      language: "nats",
      content: "@my_var = value\nPUB {{my_var}}",
    });
    // Trigger completion at {{my_var|}}
    const position = new vscode.Position(1, 10);
    const list = (await vscode.commands.executeCommand(
      "vscode.executeCompletionItemProvider",
      doc.uri,
      position,
    )) as vscode.CompletionList;

    assert.ok(list);
    assert.ok(list.items.length > 0);
    const item = list.items.find((i) => i.label === "my_var");
    assert.ok(item, "Should find local variable 'my_var'");
  });
});
