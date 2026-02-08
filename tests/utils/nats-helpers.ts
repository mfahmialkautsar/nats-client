import { TextEncoder } from "node:util";
import type { HeadersLike, MsgLike } from "@/services/nats-types";

export function createMessage(
  body: string,
  options: {
    subject?: string;
    headers?: Record<string, string>;
    reply?: string;
  } = {},
) {
  const headers = createHeaders(options.headers ?? {});
  const msg: MsgLike = {
    subject: options.subject ?? "lab.metrics",
    reply: options.reply,
    headers,
    data: new TextEncoder().encode(body),
    string: () => body,
    json: () => JSON.parse(body),
    respond: () => {
      /* no-op */
    },
  };
  return { msg };
}

export function createHeaders(entries: Record<string, string>): HeadersLike {
  return {
    get: (name: string) => entries[name],
    *[Symbol.iterator]() {
      for (const entry of Object.entries(entries)) {
        yield entry;
      }
    },
  } as HeadersLike;
}

export function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
