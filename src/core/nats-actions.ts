export type NatsActionType = "subscribe" | "request" | "publish" | "reply";

export interface NatsAction {
  readonly type: NatsActionType;
  readonly subject: string;
  readonly lineNumber: number;
  readonly server?: string;
  readonly data?: string;
  readonly template?: string;
  readonly timeoutMs?: number;
  readonly headers?: Record<string, string>;
}

export const actionKeywords: Record<NatsActionType, string> = {
  subscribe: "SUBSCRIBE",
  request: "REQUEST",
  publish: "PUBLISH",
  reply: "REPLY",
};
