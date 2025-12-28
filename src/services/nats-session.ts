import type { LogSink, LogBlock, LogItem } from "@/services/log-sink";
import { appendLogBlock } from "@/services/log-sink";
import type { JetStreamManager } from "nats";
import { readMsgHeaders } from "@/services/header-utils";
import { buildMsgHeaders } from "@/services/header-utils";
import type {
  HeaderMap,
  MsgLike,
  NatsConnectOptions,
  NatsConnectionLike,
  NatsConnector,
  SubscriptionLike,
} from "@/services/nats-types";
import { EventEmitter, type Memento } from "vscode";

interface SubscriptionContext {
  subject: string;
  stream?: string;
  consumer?: string;
  server: string;
  subscription: SubscriptionLike;
  task: Promise<void>;
  sink: LogSink;
  template?: string;
  payload?: string;
  headers?: HeaderMap;
  isJetStream?: boolean;
  filterSubject?: string;
}

interface ManagedConnection {
  serverKey: string;
  rawUrl: string;
  connection: NatsConnectionLike;
  markedClosed: boolean;
}

export interface RequestOptions {
  timeoutMs: number;
}

export interface SavedConnection {
  name: string;
  serverUrl: string;
}

export class NatsSession {
  private readonly connections = new Map<string, ManagedConnection>();
  private readonly subscriptions = new Map<string, SubscriptionContext>();
  private readonly replies = new Map<string, SubscriptionContext>();
  private readonly subscriptionCounts = new Map<string, number>();
  private readonly replyCounts = new Map<string, number>();
  private readonly savedConnections: SavedConnection[] = [];

  private readonly _onDidChangeConnection = new EventEmitter<void>();
  public readonly onDidChangeConnection = this._onDidChangeConnection.event;

  constructor(
    private readonly connector: NatsConnector,
    private readonly state: Memento,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.savedConnections = this.state.get<SavedConnection[]>(
      "nats.savedConnections",
      [],
    );
  }

  getSavedConnections(): SavedConnection[] {
    return [...this.savedConnections];
  }

  async saveConnection(connection: SavedConnection): Promise<void> {
    const index = this.savedConnections.findIndex(
      (c) => c.name === connection.name,
    );
    if (index >= 0) {
      this.savedConnections[index] = connection;
    } else {
      this.savedConnections.push(connection);
    }
    await this.state.update("nats.savedConnections", this.savedConnections);
    this._onDidChangeConnection.fire();
  }

  async deleteConnection(name: string): Promise<void> {
    const index = this.savedConnections.findIndex((c) => c.name === name);
    if (index >= 0) {
      this.savedConnections.splice(index, 1);
      await this.state.update("nats.savedConnections", this.savedConnections);
      this._onDidChangeConnection.fire();
    }
  }

  async connect(url: string): Promise<void> {
    await this.getConnection(url);
  }

  isConnectionActive(rawUrl: string): boolean {
    const serverKey = this.normalizeServerUrl(rawUrl);
    return this.getConnectionStatus(serverKey) === "connected";
  }

  async startSubscription(
    serverUrl: string,
    subject: string,
    sink: LogSink,
    key: string,
  ): Promise<void> {
    if (this.subscriptions.has(key)) {
      return;
    }
    const connection = await this.getConnection(serverUrl);
    const subscription = connection.connection.subscribe(subject);
    const task = this.consumeSubscription(
      connection.connection,
      subscription,
      subject,
      sink,
      false,
    );
    this.subscriptions.set(key, {
      subject,
      server: connection.serverKey,
      subscription,
      task,
      sink,
    });
    this.incrementCount(this.subscriptionCounts, connection.serverKey, subject);
  }

  stopSubscription(key: string): void {
    this.stopContext(this.subscriptions, key, this.subscriptionCounts);
  }

  async sendRequest(
    serverUrl: string,
    subject: string,
    payload: string,
    options: RequestOptions,
    headers?: HeaderMap,
  ): Promise<LogBlock> {
    const connection = await this.getConnection(serverUrl);
    const timestamp = this.timestamp();
    const prefix = this.connectionInfo(connection.connection);
    const response = await connection.connection.request(subject, payload, {
      timeout: options.timeoutMs,
      headers,
    });
    const responseString = safeStringResponse(response);
    const meta = { timestamp, connection: prefix, subject, type: "Request" };
    const items: LogItem[] = [
      { title: "Request", body: payload, headers },
      {
        title: "Response",
        body: responseString,
        headers: readMsgHeaders(response.headers),
      },
    ];
    return { meta, items };
  }

  async publish(
    serverUrl: string,
    subject: string,
    payload: string,
    headers?: HeaderMap,
  ): Promise<LogBlock> {
    const connection = await this.getConnection(serverUrl);
    const timestamp = this.timestamp();
    const prefix = this.connectionInfo(connection.connection);
    connection.connection.publish(subject, payload, { headers });
    await connection.connection.flush();
    const meta = { timestamp, connection: prefix, subject, type: "Publish" };
    const items: LogItem[] = [{ title: "Published", body: payload, headers }];
    return { meta, items };
  }

  isSubscribed(key: string): boolean {
    return this.subscriptions.has(key);
  }

  async startReplyHandler(
    serverUrl: string,
    subject: string,
    template: string | undefined,
    payload: string | undefined,
    sink: LogSink,
    key: string,
    replyHeaders?: HeaderMap,
  ): Promise<void> {
    if (this.replies.has(key)) {
      return;
    }
    const connection = await this.getConnection(serverUrl);
    const subscription = connection.connection.subscribe(subject);
    const task = this.consumeSubscription(
      connection.connection,
      subscription,
      subject,
      sink,
      true,
      template,
      payload,
      replyHeaders,
    );
    this.replies.set(key, {
      subject,
      server: connection.serverKey,
      subscription,
      task,
      sink,
      template,
      payload,
      headers: replyHeaders,
    });
    this.incrementCount(this.replyCounts, connection.serverKey, subject);
  }

  stopReplyHandler(key: string): void {
    this.stopContext(this.replies, key, this.replyCounts);
  }

  isReplyHandlerActive(key: string): boolean {
    return this.replies.has(key);
  }

  getSubscriptionCount(subject: string): number {
    return this.collectCount(this.subscriptionCounts, subject);
  }

  getReplyHandlerCount(subject: string): number {
    return this.collectCount(this.replyCounts, subject);
  }

  async publishJetStream(
    serverUrl: string,
    stream: string | undefined,
    subject: string,
    payload: string,
    headers?: HeaderMap,
  ): Promise<LogBlock> {
    const connection = await this.getConnection(serverUrl);
    const nc = connection.connection;
    if (!nc.jetstream) {
      throw new Error("JetStream is not available on this connection");
    }
    const js = nc.jetstream();

    const timestamp = this.timestamp();
    const prefix = this.connectionInfo(nc);

    const msgHeaders = buildMsgHeaders(headers);
    const pubAck = await js.publish(subject, payload, { headers: msgHeaders });

    const meta = {
      timestamp,
      connection: prefix,
      subject,
      stream: pubAck.stream,
      seq: pubAck.seq.toString(),
      type: "JetStream Publish",
    };
    const items: LogItem[] = [
      { title: "Published (JetStream)", body: payload, headers },
    ];
    return { meta, items };
  }

  async subscribeJetStream(
    serverUrl: string,
    stream: string,
    consumerName: string,
    subject: string | undefined,
    sink: LogSink,
    key: string,
  ): Promise<void> {
    if (this.subscriptions.has(key)) {
      return;
    }
    const connection = await this.getConnection(serverUrl);
    const nc = connection.connection;
    if (!nc.jetstream) {
      throw new Error("JetStream is not available on this connection");
    }
    const js = nc.jetstream();

    const consumer = await js.consumers.get(stream, consumerName);
    const subscription = await consumer.consume();

    const displaySubject = subject || `${stream}/${consumerName}`;

    const task = this.consumeSubscription(
      nc,
      subscription as unknown as SubscriptionLike,
      displaySubject,
      sink,
      false,
      undefined,
      undefined,
      undefined,
      stream,
      consumerName,
    );

    this.subscriptions.set(key, {
      subject: displaySubject,
      stream,
      consumer: consumerName,
      server: connection.serverKey,
      subscription: subscription as unknown as SubscriptionLike,
      task,
      sink,
      isJetStream: true,
      filterSubject: subject,
    });
    this.incrementCount(
      this.subscriptionCounts,
      connection.serverKey,
      displaySubject,
    );
  }

  async getJetStreamManager(serverUrl: string): Promise<JetStreamManager> {
    const connection = await this.getConnection(serverUrl);
    const nc = connection.connection;
    if (!nc.jetstreamManager) {
      throw new Error("JetStream Manager is not available on this connection");
    }
    return nc.jetstreamManager();
  }

  async reset(): Promise<void> {
    this.stopAll(this.subscriptions, this.subscriptionCounts);
    this.stopAll(this.replies, this.replyCounts);
    const closings = Array.from(this.connections.values()).map((entry) =>
      entry.connection.close(),
    );
    this.connections.clear();
    await Promise.allSettled(closings);
    this._onDidChangeConnection.fire();
  }

  connectionCount(): number {
    let count = 0;
    for (const conn of Array.from(this.connections.values())) {
      if (!conn.markedClosed && !conn.connection.isClosed()) {
        count++;
      }
    }
    return count;
  }

  listConnections(): Array<{
    server: string;
    url: string;
    status: "connected" | "disconnected";
  }> {
    return Array.from(this.connections.values()).map((entry) => ({
      server: entry.serverKey,
      url: entry.rawUrl,
      status:
        entry.markedClosed || entry.connection.isClosed()
          ? "disconnected"
          : "connected",
    }));
  }

  getConnectionStatus(
    serverKey: string,
  ): "connected" | "disconnected" | "unknown" {
    const connection = this.connections.get(serverKey);
    if (!connection) {
      return "unknown";
    }
    return connection.markedClosed || connection.connection.isClosed()
      ? "disconnected"
      : "connected";
  }

  markConnectionClosed(serverKey: string): void {
    const connection = this.connections.get(serverKey);
    if (connection) {
      connection.markedClosed = true;
      this._onDidChangeConnection.fire();
    }
  }

  async reconnectConnection(serverKey: string): Promise<number> {
    const existing = this.connections.get(serverKey);
    if (!existing) {
      throw new Error(`No connection found for server: ${serverKey}`);
    }
    const subsToReconnect: Array<{
      key: string;
      subject: string;
      sink: LogSink;
      isJetStream?: boolean;
      stream?: string;
      consumer?: string;
      filterSubject?: string;
    }> = [];

    const repliesToReconnect: Array<{
      key: string;
      subject: string;
      sink: LogSink;
      template?: string;
      payload?: string;
      headers?: HeaderMap;
    }> = [];

    for (const [key, ctx] of Array.from(this.subscriptions.entries())) {
      if (ctx.server === serverKey) {
        subsToReconnect.push({
          key,
          subject: ctx.subject,
          sink: ctx.sink,
          isJetStream: ctx.isJetStream,
          stream: ctx.stream,
          consumer: ctx.consumer,
          filterSubject: ctx.filterSubject,
        });
      }
    }

    for (const [key, ctx] of Array.from(this.replies.entries())) {
      if (ctx.server === serverKey) {
        repliesToReconnect.push({
          key,
          subject: ctx.subject,
          sink: ctx.sink,
          template: ctx.template,
          payload: ctx.payload,
          headers: ctx.headers,
        });
      }
    }

    const options = this.buildConnectOptions(existing.rawUrl);
    const newConnection = await this.connector(options);

    for (const sub of subsToReconnect) {
      this.stopContext(this.subscriptions, sub.key, this.subscriptionCounts);
    }

    for (const reply of repliesToReconnect) {
      this.stopContext(this.replies, reply.key, this.replyCounts);
    }

    await existing.connection.close();

    const managed: ManagedConnection = {
      serverKey,
      rawUrl: existing.rawUrl,
      connection: newConnection,
      markedClosed: false,
    };
    this.connections.set(serverKey, managed);

    for (const sub of subsToReconnect) {
      if (sub.isJetStream && sub.stream && sub.consumer) {
        await this.subscribeJetStream(
          existing.rawUrl,
          sub.stream,
          sub.consumer,
          sub.filterSubject,
          sub.sink,
          sub.key,
        );
      } else {
        await this.startSubscription(
          existing.rawUrl,
          sub.subject,
          sub.sink,
          sub.key,
        );
      }
    }

    for (const reply of repliesToReconnect) {
      await this.startReplyHandler(
        existing.rawUrl,
        reply.subject,
        reply.template,
        reply.payload,
        reply.sink,
        reply.key,
        reply.headers,
      );
    }

    return subsToReconnect.length + repliesToReconnect.length;
  }

  /**
   * Returns an array describing active subscriptions (non-reply).
   */
  listSubscriptions(): Array<{ server: string; subject: string; key: string }> {
    return Array.from(this.subscriptions.entries()).map(([key, ctx]) => ({
      server: ctx.server,
      subject: ctx.subject,
      key,
    }));
  }

  /**
   * Returns an array describing active reply handlers.
   */
  listReplyHandlers(): Array<{ server: string; subject: string; key: string }> {
    return Array.from(this.replies.entries()).map(([key, ctx]) => ({
      server: ctx.server,
      subject: ctx.subject,
      key,
    }));
  }

  private async getConnection(url: string): Promise<ManagedConnection> {
    const serverKey = this.normalizeServerUrl(url);
    const existing = this.connections.get(serverKey);
    if (existing) {
      return existing;
    }
    const options = this.buildConnectOptions(url);
    const connection = await this.connector(options);
    const managed: ManagedConnection = {
      serverKey,
      rawUrl: url,
      connection,
      markedClosed: false,
    };
    this.connections.set(serverKey, managed);
    this._onDidChangeConnection.fire();
    return managed;
  }

  private stopContext(
    store: Map<string, SubscriptionContext>,
    key: string,
    counts: Map<string, number>,
  ): void {
    const context = store.get(key);
    if (!context) {
      return;
    }
    if (context.subscription.unsubscribe) {
      context.subscription.unsubscribe();
    } else if (context.subscription.close) {
      // JetStream consumer messages
      context.subscription.close();
    }
    store.delete(key);
    this.decrementCount(counts, context.server, context.subject);
  }

  private stopAll(
    store: Map<string, SubscriptionContext>,
    counts: Map<string, number>,
  ): void {
    const keys = Array.from(store.keys());
    for (let index = 0; index < keys.length; index += 1) {
      this.stopContext(store, keys[index], counts);
    }
  }

  private async consumeSubscription(
    connection: NatsConnectionLike,
    subscription: SubscriptionLike,
    subject: string,
    sink: LogSink,
    isReply: boolean,
    template?: string,
    payload?: string,
    replyHeaders?: HeaderMap,
    stream?: string,
    consumer?: string,
  ): Promise<void> {
    const prefix = this.connectionInfo(connection);
    try {
      for await (const msg of subscription) {
        const timestamp = this.timestamp();
        if (isReply) {
          await this.handleReply(
            msg,
            subject,
            sink,
            timestamp,
            prefix,
            template,
            payload,
            replyHeaders,
          );
        } else {
          const meta: Record<string, string> = {
            timestamp,
            connection: prefix,
            subject: msg.subject,
          };

          if (stream) {
            meta.stream = stream;
          }
          if (consumer) {
            meta.consumer = consumer;
          }

          const items: LogItem[] = [
            {
              title: "Received",
              body: msg.string(),
              headers: readMsgHeaders(msg.headers),
            },
          ];
          appendLogBlock(sink, { meta, items }, "");

          // Ack message if available (JetStream)
          if (msg.ack) {
            try {
              msg.ack();
            } catch (ackError) {
              console.warn("Failed to ack message", ackError);
            }
          }
        }
      }
    } catch (error) {
      const meta = { timestamp: this.timestamp(), connection: prefix, subject };
      appendLogBlock(sink, {
        meta,
        items: [{ title: "Error", body: this.formatError(error) }],
      });
    }
  }

  private async handleReply(
    msg: MsgLike,
    subject: string,
    sink: LogSink,
    timestamp: string,
    prefix: string,
    template?: string,
    payload?: string,
    replyHeaders?: HeaderMap,
  ): Promise<void> {
    if (!msg.reply) {
      appendLogBlock(sink, {
        meta: { timestamp, connection: prefix, subject },
        items: [{ title: "Publish received (no reply)" }],
      });
      return;
    }
    const headers = buildMsgHeaders(replyHeaders);
    if (template) {
      const response = interpolateTemplate(template, msg);
      msg.respond(response, headers ? { headers } : undefined);
      const meta = { timestamp, connection: prefix, subject };
      const items: LogItem[] = [
        {
          title: "Request",
          body: msg.string(),
          headers: readMsgHeaders(msg.headers),
        },
        { title: "Reply", body: response, headers: replyHeaders },
      ];
      appendLogBlock(sink, { meta, items }, "");
      return;
    }
    if (payload) {
      msg.respond(payload, headers ? { headers } : undefined);
      const meta = { timestamp, connection: prefix, subject };
      const items: LogItem[] = [
        {
          title: "Request",
          body: msg.string(),
          headers: readMsgHeaders(msg.headers),
        },
        { title: "Reply", body: payload, headers: replyHeaders },
      ];
      appendLogBlock(sink, { meta, items }, "");
      return;
    }
    appendLogBlock(sink, {
      meta: { timestamp, connection: prefix, subject },
      items: [{ title: "Request received without template or payload" }],
    });
  }

  private connectionInfo(connection: NatsConnectionLike): string {
    const info = connection.info;
    const id = info?.client_id ?? "client";
    const host = info?.host ?? "host";
    const port = info?.port ?? "port";
    return `[${id}@${host}:${port}]`;
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private incrementCount(
    store: Map<string, number>,
    server: string,
    subject: string,
  ): void {
    const key = this.subjectKey(server, subject);
    store.set(key, (store.get(key) ?? 0) + 1);
  }

  private decrementCount(
    store: Map<string, number>,
    server: string,
    subject: string,
  ): void {
    const key = this.subjectKey(server, subject);
    const current = store.get(key) ?? 0;
    if (current <= 1) {
      store.delete(key);
    } else {
      store.set(key, current - 1);
    }
  }

  private collectCount(store: Map<string, number>, subject: string): number {
    let total = 0;
    store.forEach((value, key) => {
      if (key.endsWith(`|${subject}`)) {
        total += value;
      }
    });
    return total;
  }

  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private buildConnectOptions(url: string): NatsConnectOptions {
    const parsed = new URL(url);
    const host = `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
    return {
      servers: [host],
      user: parsed.username || undefined,
      pass: parsed.password || undefined,
    };
  }

  private normalizeServerUrl(url: string): string {
    const parsed = new URL(url);
    const auth = parsed.username
      ? `${parsed.username}${parsed.password ? `:${parsed.password}` : ""}@`
      : "";
    const port = parsed.port ? `:${parsed.port}` : "";
    return `${parsed.protocol}//${auth}${parsed.hostname}${port}`;
  }

  private subjectKey(server: string, subject: string): string {
    return `${server}|${subject}`;
  }
}

export function interpolateTemplate(template: string, msg: MsgLike): string {
  let result = template;
  result = result.replace(/\$msg\.data/g, safeStringResponse(msg));
  result = result.replace(/\$msg\.subject/g, msg.subject);
  result = result.replace(
    /\$msg\.headers\.([a-zA-Z0-9_-]+)/g,
    (_, header: string) => msg.headers?.get(header) ?? "",
  );
  result = result.replace(/\$json\.([a-zA-Z0-9_]+)/g, (_, key: string) => {
    try {
      const data = msg.json<Record<string, unknown>>();
      const value = data?.[key];
      return typeof value === "string" ? value : JSON.stringify(value ?? "");
    } catch {
      return "";
    }
  });
  return result;
}

function safeStringResponse(msg: MsgLike): string {
  try {
    return JSON.stringify(msg.json());
  } catch {
    return msg.string();
  }
}
