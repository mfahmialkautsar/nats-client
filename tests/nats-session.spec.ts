import { TextDecoder, TextEncoder } from "node:util";
import type { JetStreamClient } from "nats";
import { describe, expect, it, vi } from "vitest";
import { NatsSession, interpolateTemplate } from "@/services/nats-session";
import {
  HeadersLike,
  MsgLike,
  NatsConnectOptions,
  NatsConnectionLike,
  NatsConnector,
  SubscriptionLike,
} from "@/services/nats-types";
import { TestSink } from "@tests/helpers/test-sink";

class FakeConnection implements NatsConnectionLike {
  info = { client_id: "client", host: "localhost", port: 4222 };
  lastOptions: NatsConnectOptions | undefined;
  published: Array<{
    subject: string;
    payload: string | Uint8Array;
    headers?: Record<string, string>;
  }> = [];
  requested: Array<{
    subject: string;
    payload: string;
    timeout?: number;
    headers?: Record<string, string>;
  }> = [];
  closed = false;
  private readonly subscriptions = new Map<string, MsgLike[]>();
  requestResponse: MsgLike | undefined;
  jetstreamClient?: JetStreamClient;
  jetstream?: () => JetStreamClient;

  setSubscriptionMessages(subject: string, messages: MsgLike[]): void {
    this.subscriptions.set(subject, messages);
  }

  subscribe(subject: string): SubscriptionLike {
    const messages = this.subscriptions.get(subject) ?? [];
    const iterator = (async function* () {
      for (const message of messages) {
        yield message;
      }
    })();
    const subscription = Object.assign(iterator, {
      unsubscribe: () => {},
    });
    return subscription as SubscriptionLike;
  }

  publish(
    subject: string,
    data: string | Uint8Array,
    options?: { headers?: Record<string, string> },
  ): void {
    this.published.push({ subject, payload: data, headers: options?.headers });
  }

  async request(
    subject: string,
    data: string | Uint8Array,
    options?: { timeout?: number; headers?: Record<string, string> },
  ): Promise<MsgLike> {
    this.requested.push({
      subject,
      payload: String(data),
      timeout: options?.timeout,
      headers: options?.headers,
    });
    if (this.requestResponse) {
      return this.requestResponse;
    }
    return this.requestResponse ?? createMessage("ok").msg;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

function createConnector(connection: FakeConnection): NatsConnector {
  return async (options) => {
    connection.lastOptions = options;
    return connection;
  };
}

const DEFAULT_URL = "nats://localhost:4222";

describe("NatsSession", () => {
  it("normalizes URLs when creating connections", async () => {
    const { connection, session } = buildSession();
    await session.publish(
      "nats://user:pass@localhost:4222/demo",
      "lab.metrics",
      "payload",
    );
    expect(connection.lastOptions?.servers[0]).toBe("nats://localhost:4222");
    await session.reset();
  });

  it("sends requests with formatted logs and forwards headers", async () => {
    const { connection, session } = buildSession(
      () => new Date("2024-01-01T00:00:00Z"),
    );
    connection.requestResponse = createMessage('{"ok":true}', {
      headers: { "Processed-By": "helper" },
    }).msg;
    const log = await session.sendRequest(
      DEFAULT_URL,
      "lab.echo",
      "payload",
      { timeoutMs: 5000 },
      { Authorization: "token" },
    );
    expect(log.meta?.subject).toBe("lab.echo");
    expect(
      log.items.some((it) => it.title === "Request" && it.body === "payload"),
    ).toBe(true);
    expect(
      log.items.some(
        (it) => it.title === "Response" && it.body?.includes('{"ok":true}'),
      ),
    ).toBe(true);
    expect(
      log.items.some(
        (it) => it.title === "Request" && it.headers?.Authorization === "token",
      ),
    ).toBe(true);
    expect(
      log.items.some(
        (it) =>
          it.title === "Response" && it.headers?.["Processed-By"] === "helper",
      ),
    ).toBe(true);
    expect(connection.requested[0]).toMatchObject({
      subject: "lab.echo",
      timeout: 5000,
      headers: { Authorization: "token" },
    });
    await session.reset();
  });

  it("publishes messages, logs entries, and forwards headers", async () => {
    const { connection, session } = buildSession(
      () => new Date("2024-01-01T00:00:00Z"),
    );
    const log = await session.publish(
      DEFAULT_URL,
      "lab.metrics",
      '{"value":1}',
      { "Trace-Id": "123" },
    );
    expect(connection.published[0]).toMatchObject({
      subject: "lab.metrics",
      headers: { "Trace-Id": "123" },
    });
    expect(log.meta?.subject).toBe("lab.metrics");
    expect(
      log.items.some(
        (it) => it.title === "Published" && it.body === '{"value":1}',
      ),
    ).toBe(true);
    expect(
      log.items.some(
        (it) => it.title === "Published" && it.headers?.["Trace-Id"] === "123",
      ),
    ).toBe(true);
    await session.reset();
  });

  it("streams subscription messages into the provided sink", async () => {
    const { connection, session } = buildSession(
      () => new Date("2024-01-01T00:00:00Z"),
    );
    const sink = new TestSink();
    connection.setSubscriptionMessages("lab.metrics", [
      createMessage('{"value":1}', {
        headers: { trace: "abc" },
        subject: "lab.metrics",
      }).msg,
    ]);
    await session.startSubscription(
      DEFAULT_URL,
      "lab.metrics",
      sink,
      "sub-key",
    );
    await flushAsync();
    expect(
      sink.lines.some((line: string) => line.includes("lab.metrics")),
    ).toBe(true);
    expect(sink.lines.some((line: string) => line.includes("Headers"))).toBe(
      true,
    );
    session.stopSubscription("sub-key");
    expect(session.isSubscribed("sub-key")).toBe(false);
    await session.reset();
  });

  it("renders reply templates and responds to requesters", async () => {
    const { connection, session } = buildSession(
      () => new Date("2024-01-01T00:00:00Z"),
    );
    const sink = new TestSink();
    const templateMessage = createMessage('{"name":"Ada"}', {
      subject: "lab.greet",
      reply: "inbox",
    });
    connection.setSubscriptionMessages("lab.greet", [templateMessage.msg]);
    const responses: string[] = [];
    templateMessage.msg.respond = (value: string | Uint8Array) => {
      responses.push(
        typeof value === "string" ? value : new TextDecoder().decode(value),
      );
    };
    await session.startReplyHandler(
      DEFAULT_URL,
      "lab.greet",
      "Hello, $json.name!",
      undefined,
      sink,
      "reply-key",
    );
    await flushAsync();
    expect(responses[0]).toBe("Hello, Ada!");
    expect(sink.lines.some((line: string) => line.includes("Reply"))).toBe(
      true,
    );
    session.stopReplyHandler("reply-key");
    await session.reset();
  });

  it("uses static payloads when no template is provided", async () => {
    const { connection, session } = buildSession();
    const sink = new TestSink();
    const message = createMessage('{"value":1}', {
      subject: "lab.static",
      reply: "inbox",
    });
    connection.setSubscriptionMessages("lab.static", [message.msg]);
    const responses: string[] = [];
    message.msg.respond = (value: string | Uint8Array) => {
      responses.push(
        typeof value === "string" ? value : new TextDecoder().decode(value),
      );
    };
    await session.startReplyHandler(
      DEFAULT_URL,
      "lab.static",
      undefined,
      '{"ok":true}',
      sink,
      "payload-key",
    );
    await flushAsync();
    expect(responses[0]).toBe('{"ok":true}');
    await session.reset();
  });

  it("applies configured reply headers to outgoing responses", async () => {
    const { connection, session } = buildSession();
    const sink = new TestSink();
    const message = createMessage('{"value":1}', {
      subject: "lab.headers",
      reply: "inbox",
    });
    connection.setSubscriptionMessages("lab.headers", [message.msg]);
    const respond = vi.fn<MsgLike["respond"]>();
    message.msg.respond = respond;
    await session.startReplyHandler(
      DEFAULT_URL,
      "lab.headers",
      undefined,
      '{"ok":true}',
      sink,
      "headers-key",
      { "Responder-Id": "unit-test" },
    );
    await flushAsync();
    expect(respond).toHaveBeenCalled();
    const [, options] = respond.mock.calls[0] as Parameters<MsgLike["respond"]>;
    expect(options?.headers?.get("Responder-Id")).toBe("unit-test");
    await session.reset();
  });

  it("logs publish events that lack reply subjects", async () => {
    const { connection, session } = buildSession();
    const sink = new TestSink();
    connection.setSubscriptionMessages("lab.notify", [
      createMessage('{"value":1}', { subject: "lab.notify" }).msg,
    ]);
    await session.startReplyHandler(
      DEFAULT_URL,
      "lab.notify",
      "ignored",
      undefined,
      sink,
      "notify-key",
    );
    await flushAsync();
    expect(
      sink.lines.some((line: string) =>
        line.includes("Publish received (no reply)"),
      ),
    ).toBe(true);
    await session.reset();
  });

  it("tracks subscription counts per subject", async () => {
    const { session } = buildSession();
    const sinkA = new TestSink();
    const sinkB = new TestSink();
    await session.startSubscription(DEFAULT_URL, "lab.metrics", sinkA, "sub-a");
    await session.startSubscription(DEFAULT_URL, "lab.metrics", sinkB, "sub-b");
    expect(session.getSubscriptionCount("lab.metrics")).toBe(2);
    session.stopSubscription("sub-a");
    expect(session.getSubscriptionCount("lab.metrics")).toBe(1);
    session.stopSubscription("sub-b");
    expect(session.getSubscriptionCount("lab.metrics")).toBe(0);
    await session.reset();
  });

  it("tracks reply handler counts per subject", async () => {
    const { connection, session } = buildSession();
    const sink = new TestSink();
    const msg = createMessage('{"value":1}', {
      subject: "lab.reply",
      reply: "inbox",
    });
    connection.setSubscriptionMessages("lab.reply", [msg.msg]);
    await session.startReplyHandler(
      DEFAULT_URL,
      "lab.reply",
      "ok",
      undefined,
      sink,
      "reply-a",
    );
    expect(session.getReplyHandlerCount("lab.reply")).toBe(1);
    session.stopReplyHandler("reply-a");
    expect(session.getReplyHandlerCount("lab.reply")).toBe(0);
    await session.reset();
  });

  it("pulls JetStream batches via fetch and acknowledges each message", async () => {
    const { connection, session } = buildSession();
    const server = DEFAULT_URL;
    const ack = vi.fn();
    const first = createMessage('{"value":1}', { subject: "stream.subject" });
    const second = createMessage('{"value":2}', { subject: "stream.subject" });
    first.msg.ack = ack;
    second.msg.ack = ack;
    const fetch = vi.fn(async () =>
      createAsyncIterable([first.msg, second.msg]),
    );
    connection.jetstreamClient = {
      consumers: {
        get: vi.fn(async () => ({ fetch })),
      },
    } as unknown as JetStreamClient;
    connection.jetstream = () => connection.jetstreamClient as JetStreamClient;
    const sink = new TestSink();
    await session.pullJetStream(
      server,
      "STREAM",
      "durable",
      { batchSize: 2, timeoutMs: 1000 },
      sink,
    );
    expect(ack).toHaveBeenCalledTimes(2);
    expect(
      sink.lines.filter((line: string) => line.includes("Received:")),
    ).toHaveLength(2);
    await session.reset();
  });

  it("logs ack failures when JetStream acknowledgements throw", async () => {
    const { connection, session } = buildSession();
    const failingAck = vi.fn(() => {
      throw new Error("ack failed");
    });
    const message = createMessage('{"value":1}', { subject: "stream.subject" });
    message.msg.ack = failingAck;
    const fetch = vi.fn(async () => createAsyncIterable([message.msg]));
    connection.jetstreamClient = {
      consumers: {
        get: vi.fn(async () => ({ fetch })),
      },
    } as unknown as JetStreamClient;
    connection.jetstream = () => connection.jetstreamClient as JetStreamClient;
    const sink = new TestSink();
    await session.pullJetStream(
      DEFAULT_URL,
      "STREAM",
      "durable",
      { batchSize: 1, timeoutMs: 1000 },
      sink,
    );
    expect(sink.lines.some((line: string) => line.includes("Ack error"))).toBe(
      true,
    );
    await session.reset();
  });

  it("reports when JetStream pulls return no messages", async () => {
    const { connection, session } = buildSession();
    const fetch = vi.fn(async () => createAsyncIterable([]));
    connection.jetstreamClient = {
      consumers: {
        get: vi.fn(async () => ({ fetch })),
      },
    } as unknown as JetStreamClient;
    connection.jetstream = () => connection.jetstreamClient as JetStreamClient;
    const sink = new TestSink();
    await session.pullJetStream(
      DEFAULT_URL,
      "STREAM",
      "durable",
      { batchSize: 1, timeoutMs: 1000 },
      sink,
    );
    expect(
      sink.lines.some((line: string) => line.includes("No messages available")),
    ).toBe(true);
    await session.reset();
  });

  it("logs pull errors when JetStream fetch rejects", async () => {
    const { connection, session } = buildSession();
    const fetch = vi.fn(async () => {
      throw new Error("boom");
    });
    connection.jetstreamClient = {
      consumers: {
        get: vi.fn(async () => ({ fetch })),
      },
    } as unknown as JetStreamClient;
    connection.jetstream = () => connection.jetstreamClient as JetStreamClient;
    const sink = new TestSink();
    await session.pullJetStream(
      DEFAULT_URL,
      "STREAM",
      "durable",
      { batchSize: 1, timeoutMs: 1000 },
      sink,
    );
    expect(sink.lines.some((line: string) => line.includes("Pull error"))).toBe(
      true,
    );
    await session.reset();
  });

  it("throws when JetStream is unavailable on the connection", async () => {
    const { connection, session } = buildSession();
    delete connection.jetstream;
    delete connection.jetstreamClient;
    await expect(
      session.pullJetStream(
        DEFAULT_URL,
        "STREAM",
        "durable",
        { batchSize: 1, timeoutMs: 1000 },
        new TestSink(),
      ),
    ).rejects.toThrow("JetStream is not available");
    await session.reset();
  });

  it("disconnects and clears active subscriptions and reply handlers", async () => {
    const { connection, session } = buildSession();
    const sink = new TestSink();
    connection.setSubscriptionMessages("lab.metrics", [
      createMessage('{"value":1}', { subject: "lab.metrics" }).msg,
    ]);
    connection.setSubscriptionMessages("lab.reply", [
      createMessage('{"value":1}', { subject: "lab.reply", reply: "inbox" })
        .msg,
    ]);
    await session.startSubscription(
      DEFAULT_URL,
      "lab.metrics",
      sink,
      "sub-key",
    );
    await session.startReplyHandler(
      DEFAULT_URL,
      "lab.reply",
      "ok",
      undefined,
      sink,
      "reply-key",
    );
    await flushAsync();
    await session.reset();
    expect(connection.closed).toBe(true);
    expect(session.isSubscribed("sub-key")).toBe(false);
    expect(session.isReplyHandlerActive("reply-key")).toBe(false);
  });

  it("logs when reply handlers lack template and payload", async () => {
    const { connection, session } = buildSession();
    const sink = new TestSink();
    connection.setSubscriptionMessages("lab.empty", [
      createMessage('{"noop":true}', { subject: "lab.empty", reply: "inbox" })
        .msg,
    ]);
    await session.startReplyHandler(
      DEFAULT_URL,
      "lab.empty",
      undefined,
      undefined,
      sink,
      "empty-key",
    );
    await flushAsync();
    expect(
      sink.lines.some((line: string) =>
        line.includes("without template or payload"),
      ),
    ).toBe(true);
    await session.reset();
  });
});

describe("interpolateTemplate", () => {
  it("replaces message tokens with values", () => {
    const message = createMessage('{"value":5}', {
      subject: "lab.value",
      headers: { requestId: "123" },
      reply: "inbox",
    }).msg;
    const rendered = interpolateTemplate(
      "Value: $json.value ($msg.subject / $msg.headers.requestId)",
      message,
    );
    expect(rendered).toBe("Value: 5 (lab.value / 123)");
  });
});

function buildSession(now?: () => Date) {
  const connection = new FakeConnection();
  const session = new NatsSession(createConnector(connection), now);
  return { connection, session };
}

function createMessage(
  body: string,
  options: {
    subject?: string;
    headers?: Record<string, string>;
    reply?: string;
  } = {},
) {
  const headers = createHeaders(options.headers ?? {});
  const msg: MsgLike = {
    subject: options.subject ?? "lab.metrics",
    reply: options.reply,
    headers,
    data: new TextEncoder().encode(body),
    string: () => body,
    json: () => JSON.parse(body),
    respond: () => {},
  };
  return { msg };
}

function createHeaders(entries: Record<string, string>): HeadersLike {
  return {
    get: (name: string) => entries[name],
    *[Symbol.iterator]() {
      for (const entry of Object.entries(entries)) {
        yield entry as [string, string];
      }
    },
  } as HeadersLike;
}

function createAsyncIterable(messages: MsgLike[]): AsyncIterable<MsgLike> {
  return (async function* () {
    for (const message of messages) {
      yield message;
    }
  })();
}

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
