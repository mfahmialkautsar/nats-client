import {
  LogSink,
  appendLogBlock,
  LogBlock,
  LogItem,
} from "@/services/log-sink";
import { readMsgHeaders } from "@/services/header-utils";
import { buildMsgHeaders } from "@/services/header-utils";
import {
  HeaderMap,
  JetStreamPullOptions,
  MsgLike,
  NatsConnectOptions,
  NatsConnectionLike,
  NatsConnector,
  SubscriptionLike,
} from "@/services/nats-types";

interface SubscriptionContext {
  subject: string;
  server: string;
  subscription: SubscriptionLike;
  task: Promise<void>;
}

interface ManagedConnection {
  serverKey: string;
  rawUrl: string;
  connection: NatsConnectionLike;
}

export interface RequestOptions {
  timeoutMs: number;
}

export class NatsSession {
  private readonly connections = new Map<string, ManagedConnection>();
  private readonly subscriptions = new Map<string, SubscriptionContext>();
  private readonly replies = new Map<string, SubscriptionContext>();
  private readonly subscriptionCounts = new Map<string, number>();
  private readonly replyCounts = new Map<string, number>();

  constructor(
    private readonly connector: NatsConnector,
    private readonly now: () => Date = () => new Date(),
  ) {}

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
    const meta = { timestamp, connection: prefix, subject };
    const items: LogItem[] = [
      { title: "Request", body: payload, headers },
      {
        title: "Response",
        body: responseString,
        headers: readMsgHeaders((response as any).headers),
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
    const meta = { timestamp, connection: prefix, subject };
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

  async pullJetStream(
    serverUrl: string,
    stream: string,
    durable: string,
    options: JetStreamPullOptions,
    sink: LogSink,
  ): Promise<void> {
    const connection = await this.getConnection(serverUrl);
    const nc = connection.connection;
    if (!nc.jetstream) {
      throw new Error("JetStream is not available on this connection");
    }
    const js = nc.jetstream();
    const batchSize = Math.max(1, options.batchSize);
    const expires = Math.max(1000, options.timeoutMs);
    const prefix = this.connectionInfo(nc);
    let received = 0;

    try {
      const consumer = await js.consumers.get(stream, durable);
      const iterator = await consumer.fetch({
        max_messages: batchSize,
        expires,
      });
      for await (const msg of iterator as AsyncIterable<MsgLike>) {
        received += 1;
        const timestamp = this.timestamp();
        const meta = {
          timestamp,
          connection: prefix,
          stream,
          durable,
        } as Record<string, string>;
        const items: LogItem[] = [
          {
            title: "Received",
            body: msg.string(),
            headers: readMsgHeaders((msg as any).headers),
          },
        ];
        appendLogBlock(sink, { meta, items }, "");
        if (msg.ack) {
          try {
            await Promise.resolve(msg.ack());
          } catch (error) {
            const ts = this.timestamp();
            const metaErr = {
              timestamp: ts,
              connection: prefix,
              stream,
              durable,
            };
            appendLogBlock(
              sink,
              {
                meta: metaErr,
                items: [{ title: "Ack error", body: this.formatError(error) }],
              },
              "",
            );
          }
        }
      }
      if (received === 0) {
        const meta = {
          timestamp: this.timestamp(),
          connection: prefix,
          stream,
          durable,
        };
        appendLogBlock(sink, {
          meta,
          items: [{ title: "No messages available" }],
        });
      }
    } catch (error) {
      const meta = {
        timestamp: this.timestamp(),
        connection: prefix,
        stream,
        durable,
      };
      appendLogBlock(sink, {
        meta,
        items: [{ title: "Pull error", body: this.formatError(error) }],
      });
    }
  }

  async reset(): Promise<void> {
    this.stopAll(this.subscriptions, this.subscriptionCounts);
    this.stopAll(this.replies, this.replyCounts);
    const closings = Array.from(this.connections.values()).map((entry) =>
      entry.connection.close(),
    );
    this.connections.clear();
    await Promise.allSettled(closings);
  }

  connectionCount(): number {
    return this.connections.size;
  }

  listConnections(): Array<{ server: string; url: string }> {
    return Array.from(this.connections.values()).map((entry) => ({
      server: entry.serverKey,
      url: entry.rawUrl,
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
    const managed: ManagedConnection = { serverKey, rawUrl: url, connection };
    this.connections.set(serverKey, managed);
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
    context.subscription.unsubscribe();
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
          const meta = { timestamp, connection: prefix, subject };
          const items: LogItem[] = [
            {
              title: "Received",
              body: msg.string(),
              headers: readMsgHeaders((msg as any).headers),
            },
          ];
          appendLogBlock(sink, { meta, items }, "");
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
          headers: readMsgHeaders((msg as any).headers),
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
          headers: readMsgHeaders((msg as any).headers),
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

function formatHeaders(msg: MsgLike): string {
  if (!msg.headers) {
    return "";
  }
  const entries: Record<string, string> = {};
  const headerEntries = Array.from(
    msg.headers as Iterable<[string, string | string[]]>,
  );
  for (const [key, value] of headerEntries) {
    entries[key] = Array.isArray(value) ? value.join(",") : value;
  }
  return Object.keys(entries).length > 0
    ? ` Headers: ${JSON.stringify(entries)}`
    : "";
}

function safeStringResponse(msg: MsgLike): string {
  try {
    return JSON.stringify(msg.json());
  } catch {
    return msg.string();
  }
}

function formatOutgoingHeaders(headers?: HeaderMap): string {
  if (!headers || Object.keys(headers).length === 0) {
    return "";
  }
  return ` Headers: ${JSON.stringify(headers)}`;
}
