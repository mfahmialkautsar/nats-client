export type NatsActionType =
  | "subscribe"
  | "request"
  | "publish"
  | "reply"
  | "jetstreamPublish"
  | "jetstreamConsume";

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

  jetstreamPublish: "JSPUBLISH",
  jetstreamConsume: "JSCONSUME",
};
