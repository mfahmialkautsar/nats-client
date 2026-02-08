import { beforeEach, vi } from "vitest";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation((message) => {
    throw new Error(`Console warning detected: ${message}`);
  });
  vi.spyOn(console, "error").mockImplementation((message) => {
    throw new Error(`Console error detected: ${message}`);
  });
});
