import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { StartedTestContainer } from "testcontainers";
import { GenericContainer } from "testcontainers";
import { StringCodec, connect } from "nats";
import { NatsSession } from "@/services/nats-session";
import { createDefaultConnector } from "@/services/nats-connector";
import { TestSink } from "@tests/helpers/test-sink";
import { waitFor } from "@tests/helpers/wait-for";
import { MockMemento } from "@tests/helpers/mock-memento";

describe("NatsSession connection resilience e2e", () => {
  let container: StartedTestContainer | null = null;
  let natsUrl = "";
  let session: NatsSession | null = null;
  let helperConnection: Awaited<ReturnType<typeof connect>> | null = null;

  beforeAll(async () => {
    container = await new GenericContainer("nats:alpine")
      .withCommand(["-js"])
      .withExposedPorts(4222)
      .start();
    const port = container.getMappedPort(4222);
    natsUrl = `nats://127.0.0.1:${port}`;
    session = new NatsSession(createDefaultConnector(), new MockMemento());
    helperConnection = await connect({ servers: natsUrl });
  }, 20_000);

  afterAll(async () => {
    await helperConnection?.drain();
    await session?.reset();
    await container?.stop();
  });

  it("handles connection lifecycle: reconnect auto-restarts subscriptions and handlers", async () => {
    const subSink = new TestSink();
    const replySink = new TestSink();
    const codec = StringCodec();

    // Phase 1: Establish initial subscriptions and reply handler
    await session!.startSubscription(
      natsUrl,
      "e2e.resilience.sub",
      subSink,
      "resilience-sub",
    );
    await session!.startReplyHandler(
      natsUrl,
      "e2e.resilience.reply",
      undefined,
      '{"status":"ok"}',
      replySink,
      "resilience-reply",
    );

    // Verify initial setup
    const initialConnections = session!.listConnections();
    expect(initialConnections.length).toBe(1);
    expect(initialConnections[0].status).toBe("connected");

    // Verify subscriptions are tracked
    const activeSubs = session!.listSubscriptions();
    const activeReplies = session!.listReplyHandlers();
    expect(activeSubs.length).toBe(1);
    expect(activeReplies.length).toBe(1);

    // Verify initial subscription works
    helperConnection!.publish(
      "e2e.resilience.sub",
      codec.encode("test-before-reconnect"),
    );
    await helperConnection!.flush();
    await waitFor(
      () =>
        subSink.lines.some((line) => line.includes("test-before-reconnect")),
      { timeoutMs: 5000 },
    );

    const serverKey = initialConnections[0].server;

    // Phase 2: Call reconnectConnection - should auto-restart all subscriptions/handlers
    const restartedCount = await session!.reconnectConnection(serverKey);

    // Verify it restarted both subscription and reply handler
    expect(restartedCount).toBe(2);

    // Verify subscriptions are STILL tracked (auto-restarted)
    const subsAfterReconnect = session!.listSubscriptions();
    const repliesAfterReconnect = session!.listReplyHandlers();
    expect(subsAfterReconnect.length).toBe(1);
    expect(repliesAfterReconnect.length).toBe(1);

    // Verify connection is connected
    const reconnectedConns = session!.listConnections();
    expect(reconnectedConns.length).toBe(1);
    expect(reconnectedConns[0].status).toBe("connected");

    // Phase 3: Verify subscription automatically receives messages (no manual restart needed)
    subSink.lines = [];
    await new Promise((resolve) => setTimeout(resolve, 500)); // Give time for subscription to propagate
    helperConnection!.publish(
      "e2e.resilience.sub",
      codec.encode("test-after-auto-restart"),
    );
    await helperConnection!.flush();
    await waitFor(
      () =>
        subSink.lines.some((line) => line.includes("test-after-auto-restart")),
      { timeoutMs: 5000 },
    );
    expect(
      subSink.lines.some((line) => line.includes("test-after-auto-restart")),
    ).toBe(true);

    // Phase 4: Verify reply handler automatically responds (no manual restart needed)
    replySink.lines = [];
    const response = await helperConnection!.request(
      "e2e.resilience.reply",
      codec.encode('{"action":"test"}'),
      { timeout: 5000 },
    );

    const responseData = codec.decode(response.data);
    expect(responseData).toContain("ok");

    // Verify reply handler logged the interaction
    await waitFor(
      () => replySink.lines.some((line) => line.includes("Reply")),
      { timeoutMs: 2000 },
    );

    // Phase 5: Test session sendRequest also works
    const log = await session!.sendRequest(
      natsUrl,
      "e2e.resilience.reply",
      '{"action":"final-test"}',
      { timeoutMs: 5000 },
    );

    const responseItem = log.items.find((it) => it.title === "Response");
    expect(responseItem).toBeDefined();
    expect(responseItem!.body).toContain("ok");

    // Cleanup
    session!.stopSubscription("resilience-sub");
    session!.stopReplyHandler("resilience-reply");
  }, 60_000);
});
