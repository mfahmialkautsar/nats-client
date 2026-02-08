import { headers as createHeaders, type MsgHdrs } from "nats";
import type { HeaderMap } from "@/services/nats-types";

export function buildMsgHeaders(map?: HeaderMap): MsgHdrs | undefined {
  if (!map || Object.keys(map).length === 0) {
    return undefined;
  }
  const hdrs = createHeaders();
  for (const [key, value] of Object.entries(map)) {
    hdrs.set(key, value);
  }
  return hdrs;
}

export function readMsgHeaders(
  headers?: Iterable<[string, string | string[]]> | undefined,
): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const entry of Array.from(headers)) {
    const [k, v] = entry;
    out[k] = Array.isArray(v) ? v.join(",") : v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
