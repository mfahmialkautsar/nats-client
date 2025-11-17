import { TextEncoder } from "node:util";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { GenericContainer, StartedTestContainer } from "testcontainers";
import {
  AckPolicy,
  DeliverPolicy,
  JetStreamManager,
  StringCodec,
  connect,
  headers as createHeaders,
} from "nats";
import { NatsSession } from "@/services/nats-session";
import { createDefaultConnector } from "@/services/nats-connector";
import { TestSink } from "@tests/helpers/test-sink";
import { waitFor } from "@tests/helpers/wait-for";

const STREAM_NAME = "E2E_STREAM";
const CONSUMER_NAME = "E2E_CONSUMER";

describe("NatsSession e2e (Testcontainers)", () => {
  let container: StartedTestContainer | null = null;
  let natsUrl = "";
  let session: NatsSession | null = null;
  let helperConnection: Awaited<ReturnType<typeof connect>> | null = null;

  beforeAll(async () => {
    const started = await Promise.race([
      new GenericContainer("nats:alpine")
        .withCommand(["-js"])
        .withExposedPorts(4222)
        .start(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Container startup timed out")),
          15_000,
        ),
      ),
    ]);
    container = started;
    const port = started.getMappedPort(4222);
    natsUrl = `nats://127.0.0.1:${port}`;
    session = new NatsSession(createDefaultConnector());
    helperConnection = await connect({ servers: natsUrl });
  }, 20_000);

  afterAll(async () => {
    await helperConnection?.drain();
    await session?.reset();
    await container?.stop();
  });

  it("streams subscription output when publishers send data", async () => {
    const sink = new TestSink();
    await session!.startSubscription(natsUrl, "e2e.metrics", sink, "sub-e2e");
    await new Promise((r) => setTimeout(r, 200));
    const publishHeaders = createHeaders();
    publishHeaders.set("Content-Type", "application/json");
    helperConnection!.publish(
      "e2e.metrics",
      new TextEncoder().encode('{"value":42}'),
      { headers: publishHeaders },
    );
    await helperConnection!.flush();
    await waitFor(
      () =>
        sink.lines.some((line: string) =>
          line.includes("Content-Type: application/json"),
        ),
      { timeoutMs: 15000 },
    );
    expect(sink.lines.some((line: string) => line.includes('"value":42'))).toBe(
      true,
    );
    expect(
      sink.lines.some((line: string) =>
        line.includes("Content-Type: application/json"),
      ),
    ).toBe(true);
    session!.stopSubscription("sub-e2e");
  }, 20_000);

  it("handles request-reply round trips with payloads and headers", async () => {
    const codec = StringCodec();
    const subscription = helperConnection!.subscribe("e2e.request.reply", {
      callback: (err, msg) => {
        if (err || !msg) {
          return;
        }
        const parsed = JSON.parse(codec.decode(msg.data));
        const response = { greeting: `Hello ${parsed.name}` };
        const responseHeaders = createHeaders();
        responseHeaders.set("Processed-By", "helper");
        msg.respond(codec.encode(JSON.stringify(response)), {
          headers: responseHeaders,
        });
      },
    });
    const log = await session!.sendRequest(
      natsUrl,
      "e2e.request.reply",
      JSON.stringify({ name: "Requestor" }),
      { timeoutMs: 5000 },
      { "Content-Type": "application/json" },
    );

    const responseItem = log.items.find((it) => it.title === "Response");
    expect(responseItem).toBeDefined();
    expect(responseItem?.body).toContain('"greeting":"Hello Requestor"');
    // Ensure headers from request and response are present in the returned items
    const hasContentType = log.items.some(
      (it) => it.headers && it.headers["Content-Type"] === "application/json",
    );
    const hasProcessedBy = log.items.some(
      (it) => it.headers && it.headers["Processed-By"] === "helper",
    );
    expect(hasContentType).toBe(true);
    expect(hasProcessedBy).toBe(true);
    subscription.unsubscribe();
  }, 20_000);

  it("pulls JetStream batches through a durable consumer", async () => {
    const sink = new TestSink();
    const manager = await helperConnection!.jetstreamManager();
    await ensureStreamAndConsumer(manager);
    const codec = StringCodec();
    const jetStreamHeaders = createHeaders();
    jetStreamHeaders.set("X-Origin", "tests");
    helperConnection!.publish("e2e.jetstream", codec.encode("first"), {
      headers: jetStreamHeaders,
    });
    helperConnection!.publish("e2e.jetstream", codec.encode("second"), {
      headers: jetStreamHeaders,
    });
    await helperConnection!.flush();
    // small pause to ensure messages are persisted to the stream
    await new Promise((r) => setTimeout(r, 200));
    await session!.pullJetStream(
      natsUrl,
      STREAM_NAME,
      CONSUMER_NAME,
      { batchSize: 2, timeoutMs: 3000 },
      sink,
    );
    await waitFor(
      () =>
        sink.lines.filter((line: string) => line.includes("Received:"))
          .length >= 2,
      { timeoutMs: 15000 },
    );

    expect(sink.lines.some((line: string) => line.includes("first"))).toBe(
      true,
    );
    expect(sink.lines.some((line: string) => line.includes("second"))).toBe(
      true,
    );
    expect(
      sink.lines.some((line: string) => line.includes("X-Origin: tests")),
    ).toBe(true);
  }, 30_000);
});

async function ensureStreamAndConsumer(
  manager: JetStreamManager,
): Promise<void> {
  try {
    await manager.streams.delete(STREAM_NAME);
  } catch {
    // ignore missing stream
  }
  await manager.streams.add({
    name: STREAM_NAME,
    subjects: ["e2e.jetstream"],
  });
  try {
    await manager.consumers.delete(STREAM_NAME, CONSUMER_NAME);
  } catch {
    // ignore missing consumer
  }
  await manager.consumers.add(STREAM_NAME, {
    durable_name: CONSUMER_NAME,
    ack_policy: AckPolicy.Explicit,
    deliver_policy: DeliverPolicy.All,
  });
}
