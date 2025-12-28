import type * as vscode from "vscode";
import type { NatsSession } from "@/services/nats-session";

export class JetStreamDocumentProvider
  implements vscode.TextDocumentContentProvider
{
  constructor(private readonly session: NatsSession) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const query = new URLSearchParams(uri.query);
    const serverUrl = query.get("server");
    const type = query.get("type");
    const stream = query.get("stream");
    const consumer = query.get("consumer");

    if (!serverUrl || !type) {
      return "// Invalid URI";
    }

    try {
      const jsm = await this.session.getJetStreamManager(serverUrl);

      if (type === "stream" && stream) {
        const info = await jsm.streams.info(stream);
        return JSON.stringify(info, null, 2);
      }

      if (type === "consumer" && stream && consumer) {
        const info = await jsm.consumers.info(stream, consumer);
        return JSON.stringify(info, null, 2);
      }

      return "// Unknown type or missing parameters";
    } catch (err) {
      return `// Error: ${err}`;
    }
  }
}
