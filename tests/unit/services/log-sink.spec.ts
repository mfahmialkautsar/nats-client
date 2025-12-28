import { describe, it, expect } from "vitest";
import { appendLogBlock } from "@/services/log-sink";
import { TestSink } from "@tests/mocks/test-sink";

describe("appendLogBlock", () => {
  it("writes envelope, item lines, and headers with indent", () => {
    const sink = new TestSink();
    const block = {
      meta: {
        timestamp: "2025-11-16T00:00:00Z",
        connection: "[id@host:4222]",
        subject: "[subject]",
      },
      items: [
        {
          title: "Request",
          body: "payload",
          headers: { "Trace-Id": "trace-id-123" },
        },
        { title: "Reply", body: "ok" },
      ],
    };
    appendLogBlock(sink, block, "");
    expect(sink.lines[0]).toBe("2025-11-16T00:00:00Z");
    expect(sink.lines[1]).toBe("Meta:");
    expect(sink.lines[2]).toBe("  connection: [id@host:4222]");
    expect(sink.lines[3]).toBe("  subject: [subject]");
    // First item
    expect(sink.lines[4]).toBe("Request:");
    expect(sink.lines[5]).toBe("  Headers:");
    expect(sink.lines[6]).toBe("    Trace-Id: trace-id-123");
    expect(sink.lines[7]).toBe("  Body:");
    expect(sink.lines[8]).toBe("    payload");
    // Second item
    expect(sink.lines[9]).toBe("Reply:");
    expect(sink.lines[10]).toBe("  Body:");
    expect(sink.lines[11]).toBe("    ok");
    // trailing blank line between logs
    expect(sink.lines[12]).toBe("");
  });
});
