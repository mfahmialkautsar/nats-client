export type NatsActionType =
  | "subscribe"
  | "request"
  | "publish"
  | "reply"
  | "jetstreamPull";

export interface NatsAction {
  readonly type: NatsActionType;
  readonly subject: string;
  readonly lineNumber: number;
  readonly server?: string;
  readonly data?: string;
  readonly template?: string;
  readonly stream?: string;
  readonly durable?: string;
  readonly batchSize?: number;
  readonly timeoutMs?: number;
  readonly headers?: Record<string, string>;
}

export const actionKeywords: Record<NatsActionType, string> = {
  subscribe: "SUBSCRIBE",
  request: "REQUEST",
  publish: "PUBLISH",
  reply: "REPLY",
  jetstreamPull: "JETSTREAM",
};

export function isActionType(type: string): type is NatsActionType {
  return (
    type === "subscribe" ||
    type === "request" ||
    type === "publish" ||
    type === "reply" ||
    type === "jetstreamPull"
  );
}
