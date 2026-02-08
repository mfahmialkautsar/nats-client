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
import { MockMemento } from "@tests/mocks/memento";
import { EXAMPLES } from "@tests/utils/read-example";

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

async function setupTestEnvironment() {
  const container = await new GenericContainer("nats:alpine")
    .withExposedPorts(4222)
    .start();
  const port = container.getMappedPort(4222);
  const natsUrl = `nats://127.0.0.1:${port}`;
  const session = new NatsSession(createDefaultConnector(), new MockMemento());

  // Mock Memento
  const memento: vscode.Memento = {
    get: <T>(_key: string, defaultValue?: T) => defaultValue,
    update: () => Promise.resolve(),
    keys: () => [],
  };

  const emitterFactory = () => ({
    event: () => ({ dispose: () => {} }),
    fire: () => {},
    dispose: () => {},
  });

  const variableStore = new VariableStore(memento, emitterFactory);
  return { container, natsUrl, session, variableStore };
}

async function testVariableResolution(
  natsUrl: string,
  variableStore: VariableStore,
  session: NatsSession,
) {
  let pubSubExample = EXAMPLES.PUB_SUB;
  // Replace hardcoded URL with variables to test resolution
  pubSubExample = pubSubExample.replaceAll(
    "nats://localhost:4222/lab.metrics",
    "{{url}}/{{subject}}",
  );

  const natsFileContentWithVariables = `
@url = ${natsUrl}
@subject = test.variable

${pubSubExample}
`;

  const lines = natsFileContentWithVariables.split("\n");
  const publishLineIndex = lines.findIndex((line) =>
    line.startsWith("PUBLISH"),
  );

  const action = await resolveAction(
    natsFileContentWithVariables,
    publishLineIndex + 1,
    "publish",
    variableStore,
  );

  if (!action) {
    throw new Error("Action not found");
  }

  expect(action).toBeDefined();
  expect(action.server).toBe(natsUrl);
  expect(action.subject).toBe("test.variable");
  // The payload in example is JSON, check if it's preserved
  expect(action.data).toContain('"type": "cpu"');

  const result = await session.publish(
    action.server ?? "",
    action.subject ?? "",
    action.data ?? "",
    action.headers,
  );

  expect(result.items[0].title).toBe("Published");
}

async function testGlobalVariables(
  natsUrl: string,
  variableStore: VariableStore,
  session: NatsSession,
) {
  await variableStore.set("global_url", natsUrl);
  await variableStore.set("global_subject", "test.global");

  let pubSubExample = EXAMPLES.PUB_SUB;
  pubSubExample = pubSubExample.replaceAll(
    "nats://localhost:4222/lab.metrics",
    "{{global_url}}/{{global_subject}}",
  );

  const natsFileContent = `
${pubSubExample}
`;
  const lines = natsFileContent.split("\n");
  const publishLineIndex = lines.findIndex((line) =>
    line.startsWith("PUBLISH"),
  );

  const action = await resolveAction(
    natsFileContent,
    publishLineIndex + 1,
    "publish",
    variableStore,
  );

  if (!action) {
    throw new Error("Action not found");
  }

  expect(action).toBeDefined();
  expect(action.server).toBe(natsUrl);
  expect(action.subject).toBe("test.global");

  const result = await session.publish(
    action.server ?? "",
    action.subject ?? "",
    action.data ?? "",
    action.headers,
  );
  expect(result.items[0].title).toBe("Published");
}

async function testHeaderAndBodyResolution(
  natsUrl: string,
  variableStore: VariableStore,
) {
  let pubSubExample = EXAMPLES.PUB_SUB;

  // Replace JSON body
  const jsonStart = pubSubExample.indexOf("{");
  const jsonEnd = pubSubExample.lastIndexOf("}");
  if (jsonStart !== -1 && jsonEnd !== -1) {
    pubSubExample =
      pubSubExample.substring(0, jsonStart) +
      "Body: {{body_val}}" +
      pubSubExample.substring(jsonEnd + 1);
  }

  pubSubExample = pubSubExample
    .replaceAll("nats://localhost:4222/lab.metrics", "{{url}}/test.content")
    .replace("Trace-Id: randomId()", "X-Header: {{header_val}}");

  const natsFileContent = `
@url = ${natsUrl}
@header_val = my-header-value
@body_val = my-body-value

${pubSubExample}
`;
  const lines = natsFileContent.split("\n");
  const publishLineIndex = lines.findIndex((line) =>
    line.startsWith("PUBLISH"),
  );

  const action = await resolveAction(
    natsFileContent,
    publishLineIndex + 1,
    "publish",
    variableStore,
  );

  expect(action).toBeDefined();
  expect(action!.headers!["X-Header"]).toBe("my-header-value");
  expect(action!.data).toContain("Body: my-body-value");
}

describe("Nats Files E2E", () => {
  let container: StartedTestContainer | null = null;
  let natsUrl = "";
  let session: NatsSession | null = null;
  let variableStore: VariableStore | null = null;

  beforeAll(async () => {
    const env = await setupTestEnvironment();
    ({ container, natsUrl, session, variableStore } = env);
  }, 20_000);

  afterAll(async () => {
    await session?.reset();
    await container?.stop();
  });

  it("should resolve variables in connection string and subject", async () => {
    await testVariableResolution(natsUrl, variableStore!, session!);
  });

  it("should use global variables", async () => {
    await testGlobalVariables(natsUrl, variableStore!, session!);
  });

  it("should resolve variables in headers and body", async () => {
    await testHeaderAndBodyResolution(natsUrl, variableStore!);
  });
});
