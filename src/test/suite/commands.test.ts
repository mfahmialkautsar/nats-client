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
    const api = await extension.activate();
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("nats.showOutput"));
    assert.ok(commands.includes("nats.connections.menu"));
    assert.ok(commands.includes("nats.showSubscriptions"));
    assert.ok(commands.includes("nats.showReplyHandlers"));
    if (api) {
      assert.ok(
        (api as any).session,
        "activate() should return session for tests",
      );
      assert.ok(
        (api as any).channelRegistry,
        "activate() should return channelRegistry for tests",
      );
    }
  });

  test("command-palette flow: subscriptions quick pick actions", async () => {
    const extension = vscode.extensions.getExtension(
      "mfahmialkautsar.nats-client",
    );
    assert.ok(extension);
    const api = (await extension.activate()) as any;
    const session = api.session as any;
    const channelRegistry = api.channelRegistry as any;

    const key = "int-sub";
    const subject = "lab.integration.metrics";
    const ch = channelRegistry.acquire(subject, key);
    await session.startSubscription("nats://localhost:4222", subject, ch, key);

    const originalQuickPick = vscode.window.showQuickPick.bind(vscode.window);
    const responses: any[] = [
      { label: subject, description: "nats://localhost:4222", detail: key },
      { label: "Unsubscribe", description: "Stop the subscription" },
    ];
    (vscode.window as any).showQuickPick = async () => responses.shift();

    try {
      await vscode.commands.executeCommand("nats.showSubscriptions");
      assert.strictEqual(session.isSubscribed(key), false);
    } finally {
      (vscode.window as any).showQuickPick = originalQuickPick;
      await session.reset();
    }
  });

  test("command-palette flow: reply handlers quick pick actions", async () => {
    const extension = vscode.extensions.getExtension(
      "mfahmialkautsar.nats-client",
    );
    assert.ok(extension);
    const api = (await extension.activate()) as any;
    const session = api.session as any;
    const channelRegistry = api.channelRegistry as any;

    const key = "int-reply";
    const subject = "lab.integration.reply";
    const ch = channelRegistry.acquire(`Reply:${subject}`, key);
    await session.startReplyHandler(
      "nats://localhost:4222",
      subject,
      "ok",
      undefined,
      ch,
      key,
    );

    const originalQuickPick = vscode.window.showQuickPick.bind(vscode.window);
    const responses: any[] = [
      { label: subject, description: "nats://localhost:4222", detail: key },
      { label: "Stop Reply Handler", description: "Stop the reply handler" },
    ];
    (vscode.window as any).showQuickPick = async () => responses.shift();

    try {
      await vscode.commands.executeCommand("nats.showReplyHandlers");
      assert.strictEqual(session.isReplyHandlerActive(key), false);
    } finally {
      (vscode.window as any).showQuickPick = originalQuickPick;
      await session.reset();
    }
  });

  test("formats .nats documents via registered provider", async () => {
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.parse("untitled:test.nats"),
    );
    const editor = await vscode.window.showTextDocument(document);
    await editor.edit((edit) => {
      edit.insert(
        new vscode.Position(0, 0),
        'PUBLISH subject\n{\n"foo":"bar"\n}',
      );
    });
    const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
      "vscode.executeFormatDocumentProvider",
      document.uri,
      { insertSpaces: true, tabSize: 2 },
    );
    assert.ok(edits && edits.length > 0, "Expected formatter to produce edits");
  });
});
