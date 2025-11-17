import { describe, expect, it } from "vitest";
import {
  parseNatsDocument,
  findActionNearestLine,
  segmentNatsDocument,
} from "@/core/nats-document-parser";
import { isActionType } from "@/core/nats-actions";

const sample = `SUBSCRIBE nats://demo.nats.io/lab.metrics

###

REQUEST lab.echo
NATS-Server: nats://demo.nats.io

"Hello"

###

PUBLISH nats://demo.nats.io/lab.stream
Trace-Id: randomId()

{
  "value": 10
}

###

REPLY nats://demo.nats.io/lab.greet

Hello, $json.name!`;

describe("parseNatsDocument", () => {
  it("parses subscriptions, requests, publishes, and replies", () => {
    const actions = parseNatsDocument(sample);
    expect(actions).toHaveLength(4);
    expect(actions[0]).toMatchObject({
      type: "subscribe",
      subject: "lab.metrics",
      server: "nats://demo.nats.io",
      lineNumber: 0,
    });
    expect(actions[1]).toMatchObject({
      type: "request",
      subject: "lab.echo",
      server: "nats://demo.nats.io",
      data: '"Hello"',
    });
    expect(actions[2]).toMatchObject({
      type: "publish",
      subject: "lab.stream",
      server: "nats://demo.nats.io",
    });
    expect(actions[2].data?.includes("\n")).toBe(true);
    expect(actions[3]).toMatchObject({
      type: "reply",
      subject: "lab.greet",
      server: "nats://demo.nats.io",
      template: "Hello, $json.name!",
    });
  });

  it("captures randomId replacements and multiline payloads", () => {
    const text = `REQUEST nats://demo.nats.io/lab.id\nTrace-Id: randomId()\n\n{\n  "id": randomId()\n}`;
    const [action] = parseNatsDocument(text);
    expect(action.data).toMatch(/"id"\s*:\s*"[0-9a-f-]{36}"/i);
  });

  it("parses reply payload objects defined beneath the command", () => {
    const text = `REPLY lab.object\nNATS-Server: nats://demo.nats.io\n\n{\n  "value": 10\n}`;
    const [action] = parseNatsDocument(text);
    expect(action.type).toBe("reply");
    expect(action.data?.includes('"value"')).toBe(true);
  });

  it("parses string payloads that appear on the next line", () => {
    const text = `REQUEST lab.next\nNATS-Server: nats://demo.nats.io\n\n"payload"`;
    const [action] = parseNatsDocument(text);
    expect(action.data).toBe('"payload"');
  });

  it("captures HTTP-style header blocks defined between the command and payload", () => {
    const text = `REQUEST lab.headers\nNATS-Server: nats://demo\nAuthorization: Bearer {{token}}\nTrace-Id: randomId()\n\n"payload"`;
    const [action] = parseNatsDocument(text);
    expect(action.headers?.Authorization).toBe("Bearer {{token}}");
    expect(action.headers?.["Trace-Id"]).toMatch(/"[0-9a-f-]{36}"/i);
  });

  it("treats inline JSON bodies as payloads even without blank lines", () => {
    const text = 'PUBLISH nats://demo.nats.io/lab.inline\n{"value":1}';
    const [action] = parseNatsDocument(text);
    expect(action.type).toBe("publish");
    expect(action.headers).toBeUndefined();
    expect(action.data).toBe('{"value":1}');
  });

  it("parses jetstream pull commands with metadata and clamps batch sizes", () => {
    const text = `JETSTREAM nats://demo.nats.io/metrics
NATS-Stream: metrics
NATS-Durable: worker
NATS-Batch: 0
NATS-Timeout: 2500`;
    const [action] = parseNatsDocument(text);
    expect(action?.type).toBe("jetstreamPull");
    expect(action?.batchSize).toBe(1);
    expect(action?.timeoutMs).toBe(2500);
    expect(action?.stream).toBe("metrics");
    expect(action?.durable).toBe("worker");
  });

  it("derives subject and server from metadata when the command omits them", () => {
    const text = `REQUEST
NATS-Server: nats://demo.nats.io
NATS-Subject: lab.missing

"payload"`;
    const [action] = parseNatsDocument(text);
    expect(action?.subject).toBe("lab.missing");
    expect(action?.server).toBe("nats://demo.nats.io");
  });

  it("honors reply mode metadata when deciding between templates and payloads", () => {
    const templateText = `REPLY nats://demo.nats.io/lab.template

    Hello, $json.name!`;
    const [templateAction] = parseNatsDocument(templateText);
    expect(templateAction?.template).toContain("Hello");
    const payloadText = `REPLY nats://demo.nats.io/lab.payload
NATS-Reply-Mode: payload

{"value":42}`;
    const [payloadAction] = parseNatsDocument(payloadText);
    expect(payloadAction?.data).toContain('"value":42');
    expect(payloadAction?.template).toBeUndefined();
    const forcedTemplateText = `REPLY nats://demo.nats.io/lab.forced
NATS-Reply-Mode: template

{"value":42}`;
    const [forcedAction] = parseNatsDocument(forcedTemplateText);
    expect(forcedAction?.template).toContain('"value":42');
  });

  it("skips commented header lines and stops parsing on invalid header keys", () => {
    const text = `REQUEST lab.headers
  NATS-Server: nats://demo.nats.io
  // comment
  Trace-Id: abc
  Bad*Header: stop
  Trace-Id: ignored

  "payload"`;
    const [action] = parseNatsDocument(text);
    expect(action?.headers?.["Trace-Id"]).toBe("abc");
    expect(action?.data).toContain("Bad*Header: stop");
    expect(action?.data).toContain("Trace-Id: ignored");
  });

  it("decodes subjects embedded within URLs", () => {
    const text = "REQUEST nats://demo.nats.io/metrics%2Ftotal";
    const [action] = parseNatsDocument(text);
    expect(action?.subject).toBe("metrics/total");
  });
});

describe("findActionNearestLine", () => {
  it("returns the action located on a given zero-based line", () => {
    const actions = parseNatsDocument(sample);
    const publishLine =
      actions.find((action) => action.type === "publish")?.lineNumber ?? 0;
    const action = findActionNearestLine(actions, publishLine, "publish");
    expect(action?.subject).toBe("lab.stream");
  });
});

describe("segmentNatsDocument", () => {
  it("returns a single empty block when no delimiters exist", () => {
    const segments = segmentNatsDocument("");
    expect(segments).toHaveLength(1);
    expect(segments[0].kind).toBe("block");
    if (segments[0].kind === "block") {
      expect(segments[0].lines).toHaveLength(1);
      expect(segments[0].lines[0].text).toBe("");
    }
  });

  it("groups contiguous lines into a block until a delimiter is encountered", () => {
    const segments = segmentNatsDocument("REQUEST demo\n\n###\nPUBLISH lab");
    expect(segments[0]).toMatchObject({ kind: "block" });
    expect(segments[1]).toMatchObject({ kind: "delimiter" });
    expect(segments[2]).toMatchObject({ kind: "block" });
  });
});

describe("isActionType", () => {
  it("identifies valid action keywords", () => {
    expect(isActionType("subscribe")).toBe(true);
    expect(isActionType("reply")).toBe(true);
    expect(isActionType("unknown")).toBe(false);
  });
});
