import type { Memento } from "vscode";

export class MockMemento implements Memento {
  private storage = new Map<string, unknown>();

  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  get(key: string, defaultValue?: unknown) {
    return this.storage.get(key) ?? defaultValue;
  }

  update(key: string, value: unknown): Thenable<void> {
    this.storage.set(key, value);
    return Promise.resolve();
  }

  keys(): readonly string[] {
    return Array.from(this.storage.keys());
  }
}
