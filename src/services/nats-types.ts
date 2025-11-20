import type { JetStreamClient, MsgHdrs } from "nats";

export interface NatsConnectionInfo {
  client_id?: string | number;
  host?: string;
  port?: number;
}

export type HeaderMap = Record<string, string>;

export interface MsgLike {
  subject: string;
  reply?: string;
  headers?: HeadersLike;
  data: Uint8Array;
  string(): string;
  json<T = unknown>(): T;
  respond(data: string | Uint8Array, options?: { headers?: MsgHdrs }): void;
  ack?(): void;
}

export interface HeadersLike extends Iterable<[string, string | string[]]> {
  get(name: string): string | undefined;
}

export interface SubscriptionLike extends AsyncIterable<MsgLike> {
  unsubscribe(): void;
}

export interface NatsConnectionLike {
  info?: NatsConnectionInfo;
  subscribe(subject: string): SubscriptionLike;
  publish(
    subject: string,
    data: string | Uint8Array,
    options?: { headers?: HeaderMap },
  ): void;
  request(
    subject: string,
    data: string | Uint8Array,
    options?: { timeout?: number; headers?: HeaderMap },
  ): Promise<MsgLike>;
  jetstream?(): JetStreamClient;
  close(): Promise<void> | void;
  isClosed(): boolean;
  flush(): Promise<void>;
}

export interface NatsConnectOptions {
  servers: string[];
  user?: string;
  pass?: string;
}

export type NatsConnector = (
  options: NatsConnectOptions,
) => Promise<NatsConnectionLike>;

export interface JetStreamPullOptions {
  batchSize: number;
  timeoutMs: number;
}
