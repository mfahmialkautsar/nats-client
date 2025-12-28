import { defineConfig } from "@vscode/test-cli";

export default defineConfig([
  {
    label: "integration",
    files: "out/tests/integration/suite/**/*.test.js",
    version: "stable",
    workspaceFolder: "examples",
    mocha: {
      ui: "tdd",
      timeout: 20000,
    },
  },
]);
