import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { StartedTestContainer } from "testcontainers";
import { GenericContainer, Wait } from "testcontainers";
import type { NatsConnection, JetStreamManager, ConnectionOptions } from "nats";
import { connect, StringCodec, AckPolicy } from "nats";
import { TestSink } from "@tests/helpers/test-sink";
import { NatsSession } from "@/services/nats-session";
import type { NatsConnector, NatsConnectOptions } from "@/services/nats-types";
import { MockMemento } from "@tests/helpers/mock-memento";

const sc = StringCodec();

describe("JetStream E2E", () => {
  let container: StartedTestContainer;
  let nc: NatsConnection;
  let jsm: JetStreamManager;
  let session: NatsSession;
  let port: number;

  beforeAll(async () => {
    container = await new GenericContainer("nats:latest")
      .withCommand(["-js"])
      .withExposedPorts(4222)
      .withWaitStrategy(Wait.forLogMessage("Server is ready"))
      .start();

    port = container.getMappedPort(4222);
    const serverUrl = `nats://localhost:${port}`;

    nc = await connect({ servers: serverUrl });
    jsm = await nc.jetstreamManager();

    // Create a stream
    await jsm.streams.add({
      name: "orders",
      subjects: ["orders.*"],
    });

    // Create a consumer
    await jsm.consumers.add("orders", {
      durable_name: "monitor",
      ack_policy: AckPolicy.Explicit,
    });

    const connector = (options: NatsConnectOptions) =>
      connect({ servers: options.servers } as ConnectionOptions);
    session = new NatsSession(
      connector as unknown as NatsConnector,
      new MockMemento(),
    );
  }, 60000);

  afterAll(async () => {
    await nc?.close();
    await container?.stop();
  });

  it("should publish to JetStream", async () => {
    const serverUrl = `nats://localhost:${port}`;
    const subject = "orders.new";
    const payload = JSON.stringify({ id: "123", status: "created" });

    const result = await session.publishJetStream(
      serverUrl,
      "orders",
      subject,
      payload,
    );

    expect(result.items[0].title).toBe("Published (JetStream)");
    expect(result.items[0].body).toContain(payload);

    // Verify message in stream
    const js = nc.jetstream();
    const c = await js.consumers.get("orders", "monitor");
    const msg = await c.next();
    if (msg) {
      expect(sc.decode(msg.data)).toBe(payload);
      msg.ack();
    }
  });

  it("should subscribe to JetStream", async () => {
    const serverUrl = `nats://localhost:${port}`;
    const stream = "orders";
    const consumer = "monitor";
    const key = `${serverUrl}|${stream}/${consumer}`;
    const sink = new TestSink();

    await session.subscribeJetStream(
      serverUrl,
      stream,
      consumer,
      undefined,
      sink,
      key,
    );

    // Publish a message
    const js = nc.jetstream();
    const payload = "test-message";
    await js.publish("orders.test", sc.encode(payload));

    // Wait for message to be received
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const messages = sink.lines.join("\n");
    expect(messages).toContain("Body:");
    expect(messages).toContain(payload);

    session.stopSubscription(key);
  });
});
