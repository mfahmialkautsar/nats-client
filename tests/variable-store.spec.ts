import type { Memento, Event } from "vscode";
import { describe, expect, it } from "vitest";
import { VariableStore } from "@/services/variable-store";

class MemoryMemento implements Memento {
  private readonly data = new Map<string, unknown>();

  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.data.has(key) ? (this.data.get(key) as T) : defaultValue;
  }

  update(key: string, value: unknown): Thenable<void> {
    this.data.set(key, value);
    return Promise.resolve();
  }

  keys(): readonly string[] {
    return Array.from(this.data.keys());
  }
}

class TestEventEmitter<T> {
  private readonly listeners = new Set<(data: T) => void>();

  readonly event: Event<T> = (listener) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };

  fire(data: T): void {
    this.listeners.forEach((listener) => listener(data));
  }
}

describe("VariableStore", () => {
  it("stores per-environment variables and resolves tokens", async () => {
    const store = new VariableStore(
      new MemoryMemento(),
      () => new TestEventEmitter(),
    );
    await store.set("token", "123", "staging");
    await store.setActiveEnvironment("staging");
    expect(store.get("token")).toBe("123");
    const rendered = store.resolveText("Bearer {{token}}");
    expect(rendered).toBe("Bearer 123");
  });

  it("falls back to the original token when no value is available", () => {
    const store = new VariableStore(
      new MemoryMemento(),
      () => new TestEventEmitter(),
    );
    const rendered = store.resolveText("Value {{missing}}");
    expect(rendered).toBe("Value {{missing}}");
  });

  it("resolves records and optional strings", async () => {
    const store = new VariableStore(
      new MemoryMemento(),
      () => new TestEventEmitter(),
    );
    await store.set("trace", "abc");
    const headers = store.resolveRecord({ "Trace-Id": "{{trace}}" });
    expect(headers).toEqual({ "Trace-Id": "abc" });
    expect(store.resolveOptional(undefined)).toBeUndefined();
  });

  it("handles deletes, environment lists, and OS env fallbacks", async () => {
    const store = new VariableStore(
      new MemoryMemento(),
      () => new TestEventEmitter(),
    );
    await store.set("token", "value");
    expect(store.listVariables()).toEqual([{ key: "token", value: "value" }]);
    await store.delete("token");
    expect(store.listVariables()).toEqual([]);
    await store.set("perEnv", "staging", "staging");
    await store.setActiveEnvironment("staging");
    expect(store.listEnvironments()).toContain("staging");
    process.env.VSTEST_VALUE = "os";
    expect(store.resolveText("Value {{env:VSTEST_VALUE}}")).toBe("Value os");
    delete process.env.VSTEST_VALUE;
  });

  it("creates and deletes environments while emitting change events", async () => {
    const store = new VariableStore(
      new MemoryMemento(),
      () => new TestEventEmitter(),
    );
    const changes: number[] = [];
    store.onDidChange(() => changes.push(1));
    await store.createEnvironment("staging");
    expect(store.listEnvironments()).toContain("staging");
    await store.set("token", "123", "staging");
    await store.deleteEnvironment("staging");
    expect(store.listEnvironments()).not.toContain("staging");
    expect(store.listEnvironments()).toContain("default");
    expect(changes.length).toBeGreaterThanOrEqual(3);
  });

  it("ignores blank environment names and reverts to default after deleting the active environment", async () => {
    const store = new VariableStore(
      new MemoryMemento(),
      () => new TestEventEmitter(),
    );
    await store.createEnvironment("   ");
    expect(store.listEnvironments()).toEqual(["default"]);
    await store.createEnvironment("blue");
    await store.setActiveEnvironment("blue");
    await store.deleteEnvironment("blue");
    expect(store.activeEnvironment).toBe("default");
    expect(store.listEnvironments()).toEqual(["default"]);
  });

  it("ignores delete calls for the default or unknown environments", async () => {
    const store = new VariableStore(
      new MemoryMemento(),
      () => new TestEventEmitter(),
    );
    await store.deleteEnvironment("default");
    await store.deleteEnvironment("missing");
    expect(store.listEnvironments()).toEqual(["default"]);
  });
});
