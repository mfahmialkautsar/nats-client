import * as vscode from "vscode";
import type { NatsSession } from "@/services/nats-session";
import { TextEncoder, TextDecoder } from "node:util";
import type { JetStreamManager, StreamConfig, ConsumerConfig } from "nats";

export class JetStreamFileSystemProvider implements vscode.FileSystemProvider {
  private readonly _onDidChangeFile = new vscode.EventEmitter<
    vscode.FileChangeEvent[]
  >();
  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> =
    this._onDidChangeFile.event;

  constructor(private readonly session: NatsSession) {}

  private parseUri(uri: vscode.Uri) {
    const query = new URLSearchParams(uri.query);
    return {
      serverUrl: query.get("server"),
      type: query.get("type"),
      stream: query.get("stream"),
      consumer: query.get("consumer"),
    };
  }

  refresh(_uri: vscode.Uri): void {
    this._onDidChangeFile.fire([
      { type: vscode.FileChangeType.Changed, uri: _uri },
    ]);
  }

  watch(
    _uri: vscode.Uri,
    _options: { recursive: boolean; excludes: string[] },
  ): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  async stat(_uri: vscode.Uri): Promise<vscode.FileStat> {
    return {
      type: vscode.FileType.File,
      ctime: Date.now(),
      mtime: Date.now(),
      size: 0,
    };
  }

  async readDirectory(_uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    return [];
  }

  async createDirectory(_uri: vscode.Uri): Promise<void> {
    throw vscode.FileSystemError.NoPermissions(
      "Read-only file system (directories)",
    );
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const { serverUrl, type, stream, consumer } = this.parseUri(uri);

    if (!serverUrl || !type) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    try {
      const jsm = await this.session.getJetStreamManager(serverUrl);
      let content = "";

      if (type === "stream" && stream) {
        const info = await jsm.streams.info(stream);
        content = JSON.stringify(info, null, 2);
      } else if (type === "consumer" && stream && consumer) {
        const info = await jsm.consumers.info(stream, consumer);
        content = JSON.stringify(info, null, 2);
      } else {
        throw vscode.FileSystemError.FileNotFound(uri);
      }

      return new TextEncoder().encode(content);
    } catch (err) {
      console.error("Failed to read file for stat:", err);
      throw vscode.FileSystemError.FileNotFound(uri);
    }
  }

  private async updateStream(
    jsm: JetStreamManager,
    stream: string,
    data: unknown,
  ): Promise<void> {
    const config = ((data as { config?: StreamConfig }).config ||
      data) as StreamConfig;
    if (config.name && config.name !== stream) {
      throw new Error("Renaming stream is not supported");
    }
    const result = await jsm.streams.update(stream, config);
    const diff = getDiff(
      config as unknown as Record<string, unknown>,
      result.config as unknown as Record<string, unknown>,
    );
    if (diff.length > 0) {
      vscode.window.showWarningMessage(
        `Stream updated with discrepancies: ${diff.join(", ")}`,
      );
    } else {
      vscode.window.showInformationMessage(
        `Successfully updated stream configuration for '${stream}'`,
      );
    }
  }

  private getNewConsumerName(
    consumer: string,
    config: ConsumerConfig,
    topLevelName?: string,
  ): string {
    if (config.durable_name && config.durable_name !== consumer) {
      return config.durable_name;
    }
    if (config.name && config.name !== consumer) {
      // Ensure durable_name matches if we are renaming via name
      config.durable_name = config.name;
      return config.name;
    }
    if (topLevelName && topLevelName !== consumer) {
      // Handle top-level name change
      config.durable_name = topLevelName;
      if (config.name) {
        config.name = topLevelName;
      }
      return topLevelName;
    }
    return consumer;
  }

  private async updateConsumer(
    jsm: JetStreamManager,
    stream: string,
    consumer: string,
    data: unknown,
    uri: vscode.Uri,
    serverUrl: string,
  ): Promise<void> {
    const config = ((data as { config?: ConsumerConfig }).config ||
      data) as ConsumerConfig;
    const topLevelName = (data as { name?: string }).name;

    const newName = this.getNewConsumerName(consumer, config, topLevelName);

    if (newName === consumer) {
      const result = await jsm.consumers.update(stream, consumer, config);
      const diff = getDiff(
        config as unknown as Record<string, unknown>,
        result.config as unknown as Record<string, unknown>,
      );
      if (diff.length > 0) {
        vscode.window.showWarningMessage(
          `Consumer updated with discrepancies: ${diff.join(", ")}`,
        );
      } else {
        vscode.window.showInformationMessage(
          `Successfully updated consumer configuration for '${consumer}'`,
        );
      }
      this._onDidChangeFile.fire([
        { type: vscode.FileChangeType.Changed, uri },
      ]);
    } else {
      // Handle rename: create new, delete old
      const result = await jsm.consumers.add(stream, config);
      await jsm.consumers.delete(stream, consumer);

      const diff = getDiff(
        config as unknown as Record<string, unknown>,
        result.config as unknown as Record<string, unknown>,
      );
      if (diff.length > 0) {
        vscode.window.showWarningMessage(
          `Successfully renamed consumer to '${newName}' but with discrepancies: ${diff.join(", ")}`,
        );
      } else {
        vscode.window.showInformationMessage(
          `Successfully renamed consumer from '${consumer}' to '${newName}'`,
        );
      }

      // Notify explorer to refresh
      vscode.commands.executeCommand("nats.jetStreamExplorer.refresh");

      // Fire deleted event for old URI to close/update editor state
      this._onDidChangeFile.fire([
        { type: vscode.FileChangeType.Deleted, uri },
      ]);

      const newUri = vscode.Uri.parse(
        `nats-jetstream:/${stream}/${newName}.json?type=consumer&server=${encodeURIComponent(serverUrl)}&stream=${stream}&consumer=${newName}`,
      );
      const doc = await vscode.workspace.openTextDocument(newUri);
      await vscode.window.showTextDocument(doc, { preview: false });
    }
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    _options: { create: boolean; overwrite: boolean },
  ): Promise<void> {
    const { serverUrl, type, stream, consumer } = this.parseUri(uri);

    if (!serverUrl || !type) {
      throw vscode.FileSystemError.NoPermissions("Invalid URI");
    }

    try {
      const jsm = await this.session.getJetStreamManager(serverUrl);
      const text = new TextDecoder().decode(content);
      const data = JSON.parse(text);

      if (type === "stream" && stream) {
        await this.updateStream(jsm, stream, data);
      } else if (type === "consumer" && stream && consumer) {
        await this.updateConsumer(jsm, stream, consumer, data, uri, serverUrl);
      } else {
        throw vscode.FileSystemError.NoPermissions("Unknown type");
      }
    } catch (err) {
      throw vscode.FileSystemError.Unavailable(`Failed to update: ${err}`);
    }
  }

  async delete(
    _uri: vscode.Uri,
    _options: { recursive: boolean },
  ): Promise<void> {
    throw vscode.FileSystemError.NoPermissions("Delete not supported via FS");
  }

  async rename(
    _oldUri: vscode.Uri,
    _newUri: vscode.Uri,
    _options: { overwrite: boolean },
  ): Promise<void> {
    throw vscode.FileSystemError.NoPermissions("Rename not supported");
  }
}

function getDiff(
  desired: Record<string, unknown>,
  actual: Record<string, unknown>,
): string[] {
  const diffs: string[] = [];
  const keys = new Set([...Object.keys(desired), ...Object.keys(actual)]);

  for (const key of Array.from(keys)) {
    const dVal = desired[key];
    const aVal = actual[key];

    if (JSON.stringify(dVal) !== JSON.stringify(aVal)) {
      if (dVal === undefined) {
        diffs.push(
          `+ ${key}: ${JSON.stringify(aVal)} (added/restored by server)`,
        );
      } else if (aVal === undefined) {
        diffs.push(
          `- ${key}: ${JSON.stringify(dVal)} (ignored/removed by server)`,
        );
      } else {
        diffs.push(
          `~ ${key}: ${JSON.stringify(dVal)} => ${JSON.stringify(aVal)}`,
        );
      }
    }
  }
  return diffs;
}
