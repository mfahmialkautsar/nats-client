import { describe, expect, it } from "vitest";
import { OutputChannelRegistry } from "@/services/output-channel-registry";
import type { OutputChannelLike } from "@/services/output-channel-registry";

class StubChannel implements OutputChannelLike {
  readonly label: string;
  disposed = false;
  lines: string[] = [];

  constructor(label: string) {
    this.label = label;
  }

  appendLine(value: string): void {
    this.lines.push(value);
  }

  show(): void {}

  dispose(): void {
    this.disposed = true;
  }
}

describe("OutputChannelRegistry", () => {
  it("creates and reuses the main channel", () => {
    const registry = new OutputChannelRegistry(
      (label) => new StubChannel(label),
      "NATS",
    );
    const first = registry.main();
    const second = registry.main();
    expect(first).toBe(second);
    expect((first as StubChannel).label).toBe("NATS");
  });

  it("tracks per-subject channels with reference counting", () => {
    const registry = new OutputChannelRegistry(
      (label) => new StubChannel(label),
      "NATS",
    );
    const { channel: first } = registry.acquire("lab.metrics", "key-1");
    const { channel: second } = registry.acquire("lab.metrics", "key-2");
    expect(first).toBe(second);
    registry.release("key-1");
    expect((first as StubChannel).disposed).toBe(false);
    registry.release("key-2");
    expect((first as StubChannel).disposed).toBe(true);
  });

  it("disposes everything on disposeAll", () => {
    const registry = new OutputChannelRegistry(
      (label) => new StubChannel(label),
      "NATS",
    );
    const { channel: subjectChannel } = registry.acquire("lab.alerts", "key");
    const mainChannel = registry.main();
    registry.disposeAll();
    expect((subjectChannel as StubChannel).disposed).toBe(true);
    expect((mainChannel as StubChannel).disposed).toBe(true);
  });
});
