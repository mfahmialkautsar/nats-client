import { LogSink } from "@/services/log-sink";

export class TestSink implements LogSink {
  readonly lines: string[] = [];

  appendLine(value: string): void {
    this.lines.push(value);
  }
}
