import * as vscode from "vscode";
import type { NatsSession } from "@/services/nats-session";
import type { StreamInfo, ConsumerInfo } from "nats";
import type { JetStreamFileSystemProvider } from "./jetstream-fs-provider";

export class JetStreamExplorerProvider implements vscode.TreeDataProvider<JetStreamNode> {
  private _onDidChangeTreeData: vscode.EventEmitter<
    JetStreamNode | undefined | null | void
  > = new vscode.EventEmitter<JetStreamNode | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    JetStreamNode | undefined | null | void
  > = this._onDidChangeTreeData.event;

  constructor(
    private readonly session: NatsSession,
    private readonly fsProvider: JetStreamFileSystemProvider,
  ) {
    this.session.onDidChangeConnection(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: JetStreamNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: JetStreamNode): Promise<JetStreamNode[]> {
    if (!element) {
      // Root: List connected servers
      const connections = this.session.listConnections();
      // Filter only connected servers for JetStream exploration
      return connections
        .filter((conn) => conn.status === "connected")
        .map(
          (conn) =>
            new ServerNode(
              conn.server,
              conn.url,
              vscode.TreeItemCollapsibleState.Collapsed,
            ),
        );
    }

    if (element instanceof ServerNode) {
      try {
        const jsm = await this.session.getJetStreamManager(element.url);
        const streams = await jsm.streams.list().next();
        return streams.map(
          (stream: StreamInfo) =>
            new StreamNode(
              stream.config.name,
              element.url,
              vscode.TreeItemCollapsibleState.Collapsed,
            ),
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to list streams for ${element.label}: ${error}`,
        );
        return [];
      }
    }

    if (element instanceof StreamNode) {
      try {
        const jsm = await this.session.getJetStreamManager(element.serverUrl);
        const consumers = await jsm.consumers.list(element.streamName).next();
        return consumers.map(
          (consumer: ConsumerInfo) =>
            new ConsumerNode(
              consumer.name,
              element.streamName,
              element.serverUrl,
              vscode.TreeItemCollapsibleState.None,
            ),
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to list consumers for ${element.label}: ${error}`,
        );
        return [];
      }
    }

    return [];
  }

  async createStream(node: ServerNode) {
    const name = await vscode.window.showInputBox({ prompt: "Stream Name" });
    if (!name) {
      return;
    }
    const subjectsStr = await vscode.window.showInputBox({
      prompt: "Subjects (comma separated)",
    });
    if (!subjectsStr) {
      return;
    }
    const subjects = subjectsStr.split(",").map((s) => s.trim());

    try {
      const jsm = await this.session.getJetStreamManager(node.url);
      await jsm.streams.add({ name, subjects });
      this.refresh();
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to create stream: ${err}`);
    }
  }

  async deleteStream(node: StreamNode) {
    const confirm = await vscode.window.showWarningMessage(
      `Delete stream ${node.streamName}?`,
      "Yes",
      "No",
    );
    if (confirm !== "Yes") {
      return;
    }

    try {
      const jsm = await this.session.getJetStreamManager(node.serverUrl);
      await jsm.streams.delete(node.streamName);
      this.refresh();
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to delete stream: ${err}`);
    }
  }

  async createConsumer(node: StreamNode) {
    const name = await vscode.window.showInputBox({ prompt: "Consumer Name" });
    if (!name) {
      return;
    }

    try {
      const jsm = await this.session.getJetStreamManager(node.serverUrl);
      const { AckPolicy } = require("nats");
      await jsm.consumers.add(node.streamName, {
        durable_name: name,
        ack_policy: AckPolicy.Explicit,
      });
      this.refresh();
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to create consumer: ${err}`);
    }
  }

  async deleteConsumer(node: ConsumerNode) {
    const confirm = await vscode.window.showWarningMessage(
      `Delete consumer ${node.consumerName}?`,
      "Yes",
      "No",
    );
    if (confirm !== "Yes") {
      return;
    }

    try {
      const jsm = await this.session.getJetStreamManager(node.serverUrl);
      await jsm.consumers.delete(node.streamName, node.consumerName);
      this.refresh();
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to delete consumer: ${err}`);
    }
  }

  async viewStreamInfo(node: StreamNode) {
    try {
      const uri = vscode.Uri.parse(
        `nats-jetstream:/${node.streamName}.json?type=stream&server=${encodeURIComponent(node.serverUrl)}&stream=${node.streamName}`,
      );
      this.fsProvider.refresh(uri);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to get stream info: ${err}`);
    }
  }

  async viewConsumerInfo(node: ConsumerNode) {
    try {
      const uri = vscode.Uri.parse(
        `nats-jetstream:/${node.streamName}/${node.consumerName}.json?type=consumer&server=${encodeURIComponent(node.serverUrl)}&stream=${node.streamName}&consumer=${node.consumerName}`,
      );
      this.fsProvider.refresh(uri);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to get consumer info: ${err}`);
    }
  }
}

export abstract class JetStreamNode extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super(label, collapsibleState);
  }
}

export class ServerNode extends JetStreamNode {
  constructor(
    public readonly serverName: string,
    public readonly url: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super(serverName, collapsibleState);
    this.contextValue = "serverNode";
    this.iconPath = new vscode.ThemeIcon("server");
    this.description = url;
  }
}

export class StreamNode extends JetStreamNode {
  constructor(
    public readonly streamName: string,
    public readonly serverUrl: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super(streamName, collapsibleState);
    this.contextValue = "streamNode";
    this.iconPath = new vscode.ThemeIcon("database");
  }
}

export class ConsumerNode extends JetStreamNode {
  constructor(
    public readonly consumerName: string,
    public readonly streamName: string,
    public readonly serverUrl: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super(consumerName, collapsibleState);
    this.contextValue = "consumerNode";
    this.iconPath = new vscode.ThemeIcon("output");
  }
}
