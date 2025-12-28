import { TextEncoder } from "node:util";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { StartedTestContainer } from "testcontainers";
import { GenericContainer } from "testcontainers";
import { StringCodec, connect, headers as createHeaders } from "nats";
import { NatsSession } from "@/services/nats-session";
import { createDefaultConnector } from "@/services/nats-connector";
import { TestSink } from "@tests/mocks/test-sink";
import { waitFor } from "@tests/utils/wait-for";
import { MockMemento } from "@tests/mocks/memento";

describe("NatsSession e2e (Testcontainers)", () => {
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

  it("streams subscription output when publishers send data", async () => {
    const sink = new TestSink();
    await session!.startSubscription(natsUrl, "e2e.metrics", sink, "sub-e2e");
    await new Promise((r) => setTimeout(r, 200));
    const publishHeaders = createHeaders();
    publishHeaders.set("Trace-Id", "trace-id-123");
    helperConnection!.publish(
      "e2e.metrics",
      new TextEncoder().encode('{"value":42}'),
      { headers: publishHeaders },
    );
    await helperConnection!.flush();
    await waitFor(
      () =>
        sink.lines.some((line: string) =>
          line.includes("Trace-Id: trace-id-123"),
        ),
      { timeoutMs: 15000 },
    );
    expect(sink.lines.some((line: string) => line.includes('"value":42'))).toBe(
      true,
    );
    expect(
      sink.lines.some((line: string) =>
        line.includes("Trace-Id: trace-id-123"),
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
      { "Trace-Id": "trace-id-123" },
    );

    const responseItem = log.items.find((it) => it.title === "Response");
    expect(responseItem).toBeDefined();
    expect(responseItem!.body).toContain('"greeting":"Hello Requestor"');
    // Ensure headers from request and response are present in the returned items
    const hasContentType = log.items.some(
      (it) => it.headers && it.headers["Trace-Id"] === "trace-id-123",
    );
    const hasProcessedBy = log.items.some(
      (it) => it.headers && it.headers["Processed-By"] === "helper",
    );
    expect(hasContentType).toBe(true);
    expect(hasProcessedBy).toBe(true);
    subscription.unsubscribe();
  }, 20_000);
});
