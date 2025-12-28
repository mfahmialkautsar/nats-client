export interface WaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  options: WaitOptions = {},
): Promise<void> {
  const { timeoutMs = 5000, intervalMs = 25 } = options;
  const start = Date.now();
  while (true) {
    if (await predicate()) {
      return;
    }
    if (Date.now() - start >= timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
