import type { Memento, Event } from "vscode";

interface EventEmitterLike<T> {
  event: Event<T>;
  fire(data: T): void;
}

interface VariableSnapshot {
  activeEnvironment: string;
  environments: Record<string, Record<string, string>>;
}

const STORAGE_KEY = "natsClient.variables";
const DEFAULT_ENVIRONMENT = "default";
const TOKEN_PATTERN = /\{\{([^}]+)\}\}/g;

export class VariableStore {
  private state: VariableSnapshot;
  private readonly emitter: EventEmitterLike<void>;
  readonly onDidChange: Event<void>;

  constructor(
    private readonly storage: Memento,
    emitterFactory?: () => EventEmitterLike<void>,
  ) {
    this.state = storage.get<VariableSnapshot>(STORAGE_KEY) ?? {
      activeEnvironment: DEFAULT_ENVIRONMENT,
      environments: { [DEFAULT_ENVIRONMENT]: {} },
    };
    if (emitterFactory) {
      this.emitter = emitterFactory();
    } else {
      const vscode = require("vscode") as typeof import("vscode");
      this.emitter = new vscode.EventEmitter<void>();
    }
    this.onDidChange = this.emitter.event;
  }

  get activeEnvironment(): string {
    return this.state.activeEnvironment;
  }

  listEnvironments(): string[] {
    return Object.keys(this.state.environments).sort();
  }

  listVariables(
    environment = this.activeEnvironment,
  ): Array<{ key: string; value: string }> {
    const entries = Object.entries(this.state.environments[environment] ?? {});
    return entries
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  get(name: string, environment = this.activeEnvironment): string | undefined {
    return this.state.environments[environment]?.[name];
  }

  async set(
    name: string,
    value: string,
    environment = this.activeEnvironment,
  ): Promise<void> {
    const env = this.ensureEnvironment(environment);
    env[name] = value;
    await this.persist();
    this.emitter.fire();
  }

  async delete(
    name: string,
    environment = this.activeEnvironment,
  ): Promise<void> {
    const env = this.ensureEnvironment(environment);
    delete env[name];
    await this.persist();
    this.emitter.fire();
  }

  async setActiveEnvironment(name: string): Promise<void> {
    this.ensureEnvironment(name);
    this.state.activeEnvironment = name;
    await this.persist();
    this.emitter.fire();
  }

  async createEnvironment(name: string): Promise<void> {
    if (!name.trim()) {
      return;
    }
    this.ensureEnvironment(name);
    await this.persist();
    this.emitter.fire();
  }

  async deleteEnvironment(name: string): Promise<void> {
    if (name === DEFAULT_ENVIRONMENT) {
      return;
    }
    if (!this.state.environments[name]) {
      return;
    }
    delete this.state.environments[name];
    if (this.state.activeEnvironment === name) {
      this.state.activeEnvironment =
        Object.keys(this.state.environments)[0] ?? DEFAULT_ENVIRONMENT;
    }
    if (!this.state.environments[this.state.activeEnvironment]) {
      this.state.activeEnvironment = DEFAULT_ENVIRONMENT;
      this.ensureEnvironment(DEFAULT_ENVIRONMENT);
    }
    await this.persist();
    this.emitter.fire();
  }

  resolveText(value: string): string {
    return value.replace(TOKEN_PATTERN, (match, rawToken) => {
      const token = rawToken.trim();
      if (token.startsWith("env:")) {
        const envName = token.slice(4);
        return process.env[envName] ?? match;
      }
      return this.get(token) ?? match;
    });
  }

  resolveOptional(value: string | undefined): string | undefined {
    return typeof value === "string" ? this.resolveText(value) : undefined;
  }

  resolveRecord(
    record: Record<string, string> | undefined,
  ): Record<string, string> | undefined {
    if (!record) {
      return undefined;
    }
    const resolved: Record<string, string> = {};
    for (const [key, value] of Object.entries(record)) {
      resolved[key] = this.resolveText(value);
    }
    return resolved;
  }

  private ensureEnvironment(name: string): Record<string, string> {
    if (!this.state.environments[name]) {
      this.state.environments[name] = {};
    }
    return this.state.environments[name];
  }

  private persist(): Thenable<void> {
    return this.storage.update(STORAGE_KEY, this.state);
  }
}
