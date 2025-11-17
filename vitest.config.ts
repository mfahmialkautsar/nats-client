import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const resolveFromRoot = (segment: string) => path.resolve(rootDir, segment);

export default defineConfig({
  resolve: {
    alias: {
      "@": resolveFromRoot("src"),
      "@tests": resolveFromRoot("tests"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.spec.ts"],
    exclude: ["out/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      thresholds: {
        statements: 85,
        branches: 75,
        functions: 90,
        lines: 85,
      },
      exclude: ["out/**"],
    },
  },
});
