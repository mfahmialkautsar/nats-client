import { RequestOptions } from "nats";
import { connect, ConnectionOptions, NatsConnection } from "nats";
import {
  HeaderMap,
  NatsConnectOptions,
  NatsConnector,
  NatsConnectionLike,
} from "@/services/nats-types";
import { buildMsgHeaders } from "@/services/header-utils";

export function createDefaultConnector(): NatsConnector {
  return async (options: NatsConnectOptions) =>
    wrapConnection(await connect(options as ConnectionOptions));
}

export function wrapConnection(connection: NatsConnection): NatsConnectionLike {
  return {
    get info() {
      return connection.info;
    },
    subscribe: (subject: string) => connection.subscribe(subject),
    publish: (
      subject: string,
      data: string | Uint8Array,
      options?: { headers?: HeaderMap },
    ) => {
      const headers = buildMsgHeaders(options?.headers);
      const publishOptions = headers ? { headers } : undefined;
      connection.publish(subject, data, publishOptions);
    },
    request: (
      subject: string,
      data: string | Uint8Array,
      options?: { timeout?: number; headers?: HeaderMap },
    ) => {
      const requestOptions: RequestOptions = {
        timeout: options?.timeout ?? 10_000,
      };
      const headerBag = buildMsgHeaders(options?.headers);
      if (headerBag) {
        requestOptions.headers = headerBag;
      }
      return connection.request(subject, data, requestOptions);
    },
    jetstream: () => connection.jetstream(),
    close: () => connection.close(),
    isClosed: () => connection.isClosed(),
    flush: () => connection.flush(),
  };
}
