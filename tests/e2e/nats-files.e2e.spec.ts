import {
  describe,
  expect,
  it,
  beforeAll,
  afterAll,
  vi,
  type Mock,
} from "vitest";
import type { StartedTestContainer } from "testcontainers";
import { GenericContainer } from "testcontainers";
import { TestSink } from "@tests/helpers/test-sink";

// Mock vscode module
vi.mock("vscode", () => {
  return {
    workspace: {
      openTextDocument: vi.fn(),
    },
    Uri: {
      file: vi.fn((path) => ({ path, scheme: "file" })),
    },
    EventEmitter: class {
      event = () => {};
      fire() {}
      dispose() {}
    },
  };
});

// Import after mocking
import { resolveAction } from "@/commands/utils";
import { VariableStore } from "@/services/variable-store";
import { NatsSession } from "@/services/nats-session";
import { createDefaultConnector } from "@/services/nats-connector";
import * as vscode from "vscode"; // Import mocked vscode to configure mocks

// Configure mocks
const mockOpenTextDocument = async (content: string) => ({
  getText: () => content,
});

(vscode.workspace.openTextDocument as unknown as Mock).mockImplementation(
  async (uri: { path: string }) => {
    return mockOpenTextDocument(uri.path);
  },
);

describe("Nats Files E2E", () => {
  let container: StartedTestContainer | null = null;
  let natsUrl = "";
  let session: NatsSession | null = null;
  let variableStore: VariableStore | null = null;

  beforeAll(async () => {
    container = await new GenericContainer("nats:alpine")
      .withExposedPorts(4222)
      .start();
    const port = container.getMappedPort(4222);
    natsUrl = `nats://127.0.0.1:${port}`;
    session = new NatsSession(createDefaultConnector());

    // Mock Memento
    const memento: vscode.Memento = {
      get: <T>(key: string, defaultValue?: T) => defaultValue,
      update: () => Promise.resolve(),
    };

    const emitterFactory = () => ({
      event: () => ({ dispose: () => {} }),
      fire: () => {},
      dispose: () => {},
    });

    variableStore = new VariableStore(memento, emitterFactory);
  }, 20_000);

  afterAll(async () => {
    await session?.reset();
    await container?.stop();
  });

  it("should resolve variables in connection string and subject", async () => {
    const natsFileContent = `
@url = ${natsUrl}
@subject = test.variable

PUBLISH {{url}}/{{subject}}
Payload
`;
    // We pass content as filePath because of our mock
    const action = await resolveAction(
      natsFileContent,
      5,
      "publish",
      variableStore!,
    );

    if (!action) {
      throw new Error("Action not found");
    }

    expect(action).toBeDefined();
    expect(action.server).toBe(natsUrl);
    expect(action.subject).toBe("test.variable");
    expect(action.data).toBe("Payload");

    const sink = new TestSink();
    const result = await session!.publish(
      action.server ?? "",
      action.subject ?? "",
      action.data ?? "",
      action.headers,
    );

    expect(result.items[0].title).toBe("Published");
  });

  it("should use global variables", async () => {
    await variableStore!.set("global_url", natsUrl);
    await variableStore!.set("global_subject", "test.global");

    const natsFileContent = `
PUBLISH {{global_url}}/{{global_subject}}
Global Payload
`;
    const action = await resolveAction(
      natsFileContent,
      2,
      "publish",
      variableStore!,
    );

    if (!action) {
      throw new Error("Action not found");
    }

    expect(action).toBeDefined();
    expect(action.server).toBe(natsUrl);
    expect(action.subject).toBe("test.global");

    const result = await session!.publish(
      action.server ?? "",
      action.subject ?? "",
      action.data ?? "",
      action.headers,
    );
    expect(result.items[0].title).toBe("Published");
  });

  it("should resolve variables in headers and body", async () => {
    const natsFileContent = `
@url = ${natsUrl}
@header_val = my-header-value
@body_val = my-body-value

PUBLISH {{url}}/test.content
X-Header: {{header_val}}

Body: {{body_val}}
`;
    const action = await resolveAction(
      natsFileContent,
      6,
      "publish",
      variableStore!,
    );

    expect(action).toBeDefined();
    expect(action?.headers?.["X-Header"]).toBe("my-header-value");
    expect(action?.data).toContain("Body: my-body-value");
  });
});
