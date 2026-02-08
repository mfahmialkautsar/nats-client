import type {
  MsgLike,
  NatsConnectionLike,
  NatsConnectOptions,
  SubscriptionLike,
} from "@/services/nats-types";
import { createMessage } from "@tests/utils/nats-helpers";

export class FakeNatsConnection implements NatsConnectionLike {
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

  constructor(options?: NatsConnectOptions) {
    this.lastOptions = options;
  }

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
      unsubscribe: () => {
        /* no-op */
      },
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

  isClosed(): boolean {
    return this.closed;
  }

  async flush(): Promise<void> {
    // No-op for tests
  }
}
