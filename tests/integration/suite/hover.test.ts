import * as assert from "assert";
import * as vscode from "vscode";
import { suite, test } from "mocha";

suite("Hover Provider E2E Test Suite", () => {
  vscode.window.showInformationMessage("Start Hover E2E tests.");

  test("Provides Hover for Variables in .nats files", async () => {
    const extension = vscode.extensions.getExtension(
      "mfahmialkautsar.nats-client",
    );
    await extension?.activate();

    if (!vscode.workspace.workspaceFolders) {
      throw new Error("No workspace folder found");
    }
    const workspaceUri = vscode.workspace.workspaceFolders[0].uri;
    const docUri = vscode.Uri.joinPath(workspaceUri, "jetstream.nats");
    const doc = await vscode.workspace.openTextDocument(docUri);
    await vscode.window.showTextDocument(doc);

    await new Promise((r) => setTimeout(r, 1000));

    const position = new vscode.Position(11, 12);

    const ro = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      doc.uri,
      position,
    );

    assert.ok(ro, "Hover results should be returned");
    const hasUrl = ro.some((h) => {
      return h.contents.some((c) => {
        const val =
          typeof c === "string" ? c : (c as unknown as { value: string }).value;
        return val.includes("url") && val.includes("Local Variable");
      });
    });

    assert.ok(hasUrl, "Should show hover for local variable 'url'");
  });
});
