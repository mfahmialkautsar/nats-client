import type { LogSink } from "@/services/log-sink";

export class TestSink implements LogSink {
  lines: string[] = [];

  appendLine(value: string): void {
    this.lines.push(value);
  }
}
