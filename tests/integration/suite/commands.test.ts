import * as assert from "assert";
import * as vscode from "vscode";
import type { StartedTestContainer } from "testcontainers";
import { GenericContainer, Wait } from "testcontainers";
import { before, after, suite, test } from "mocha";
import type { ExtensionAPI } from "@/extension";

suite("NATS Client VS Code integration", function () {
  this.timeout(60000); // Increase timeout for container startup

  let container: StartedTestContainer | undefined;
  let natsUrl: string;

  before(async () => {
    try {
      console.log("Starting NATS container...");
      container = await new GenericContainer("nats:alpine")
        .withExposedPorts(4222)
        .withCommand(["-js"]) // Enable JetStream
        .withWaitStrategy(Wait.forLogMessage("Server is ready"))
        .start();

      const host = container.getHost();
      const port = container.getMappedPort(4222);
      natsUrl = `nats://${host}:${port}`;
      console.log(`NATS Integration Test Server running at ${natsUrl}`);
    } catch (err) {
      console.error("Failed to start NATS container:", err);
      throw err;
    }
  });

  after(async () => {
    if (container) {
      await container.stop();
    }
  });

  test("activates extension and registers commands", async () => {
    const extension = vscode.extensions.getExtension(
      "mfahmialkautsar.nats-client",
    );
    assert.ok(extension);
    await extension.activate();
    assert.ok(extension.isActive);

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("nats.startSubscription"));
    assert.ok(commands.includes("nats.publish"));
  });

  test("command-palette flow: subscriptions quick pick actions", async () => {
    const extension = vscode.extensions.getExtension(
      "mfahmialkautsar.nats-client",
    );
    assert.ok(extension);
    const api = (await extension.activate()) as ExtensionAPI;
    const session = api.session;
    const channelRegistry = api.channelRegistry;

    const key = "int-sub";
    const subject = "lab.integration.metrics";
    const ch = channelRegistry.acquire(subject, key);

    await session.startSubscription(natsUrl, subject, ch.channel, key);

    const originalQuickPick = vscode.window.showQuickPick.bind(vscode.window);
    const responses: vscode.QuickPickItem[] = [
      { label: subject, description: natsUrl, detail: key },
      { label: "Unsubscribe", description: "Stop the subscription" },
    ];
    (vscode.window as unknown as Record<string, unknown>).showQuickPick =
      async () => responses.shift();

    try {
      await vscode.commands.executeCommand("nats.showSubscriptions");
      assert.strictEqual(session.isSubscribed(key), false);
    } finally {
      (vscode.window as unknown as Record<string, unknown>).showQuickPick =
        originalQuickPick;
      await session.reset();
    }
  });

  test("command-palette flow: reply handlers quick pick actions", async () => {
    const extension = vscode.extensions.getExtension(
      "mfahmialkautsar.nats-client",
    );
    assert.ok(extension);
    const api = (await extension.activate()) as ExtensionAPI;
    const session = api.session;
    const channelRegistry = api.channelRegistry;

    const key = "int-reply";
    const subject = "lab.integration.reply";
    const ch = channelRegistry.acquire(`Reply:${subject}`, key);

    await session.startReplyHandler(
      natsUrl,
      subject,
      "ok",
      undefined,
      ch.channel,
      key,
    );

    const originalQuickPick = vscode.window.showQuickPick.bind(vscode.window);
    const responses: vscode.QuickPickItem[] = [
      { label: subject, description: natsUrl, detail: key },
      { label: "Stop Reply Handler", description: "Stop the reply handler" },
    ];
    (vscode.window as unknown as Record<string, unknown>).showQuickPick =
      async () => responses.shift();

    try {
      await vscode.commands.executeCommand("nats.showReplyHandlers");
      assert.strictEqual(session.isReplyHandlerActive(key), false);
    } finally {
      (vscode.window as unknown as Record<string, unknown>).showQuickPick =
        originalQuickPick;
      await session.reset();
    }
  });

  test("formats .nats documents via registered provider", async () => {
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.parse("untitled:test-fmt.nats"),
    );
    const editor = await vscode.window.showTextDocument(document);
    await editor.edit((edit) => {
      edit.insert(
        new vscode.Position(0, 0),
        'PUBLISH subject\n{\n"foo":"bar"\n}',
      );
    });
    // Wait for extension activation implicitly usually works, but ensuring it is active:
    const extension = vscode.extensions.getExtension(
      "mfahmialkautsar.nats-client",
    );
    await extension?.activate();

    // Sometimes provider needs a moment
    await new Promise((r) => setTimeout(r, 500));

    const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
      "vscode.executeFormatDocumentProvider",
      document.uri,
      { insertSpaces: true, tabSize: 2 },
    );
    assert.ok(edits && edits.length > 0, "Expected formatter to produce edits");
  });
});
