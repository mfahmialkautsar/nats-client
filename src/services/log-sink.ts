export interface LogSink {
  appendLine(value: string): void;
}
export interface LogItem {
  title: string;
  body?: string;
  headers?: Record<string, string>;
}

export interface LogBlock {
  meta?: Record<string, string>;
  items: LogItem[];
}

export function appendLogBlock(
  sink: LogSink,
  block: LogBlock,
  indent = "",
): void {
  const baseIndent = indent;
  const childIndent = baseIndent + "  ";
  const leafIndent = childIndent + "  ";

  const timestamp =
    block.meta && Object.prototype.hasOwnProperty.call(block.meta, "timestamp")
      ? String((block.meta as Record<string, string>)["timestamp"])
      : undefined;
  if (timestamp) {
    sink.appendLine(`${baseIndent}${timestamp}`);
  }

  const metaEntries = block.meta
    ? Object.entries(block.meta).filter(([k]) => k !== "timestamp")
    : [];
  if (metaEntries.length > 0) {
    sink.appendLine(`${baseIndent}Meta:`);
    for (const [k, v] of metaEntries) {
      sink.appendLine(`${childIndent}${k}: ${v}`);
    }
  }

  for (const item of block.items) {
    sink.appendLine(`${baseIndent}${item.title}:`);

    if (item.headers && Object.keys(item.headers).length > 0) {
      sink.appendLine(`${childIndent}Headers:`);
      for (const [hk, hv] of Object.entries(item.headers)) {
        sink.appendLine(`${leafIndent}${hk}: ${hv}`);
      }
    }

    const body =
      item.body !== undefined && item.body !== null ? String(item.body) : "";
    sink.appendLine(childIndent + "Body:");
    const lines = body.split(/\r?\n/);
    for (const line of lines) {
      sink.appendLine(leafIndent + line);
    }
  }

  sink.appendLine("");
}

export class CompositeLogSink implements LogSink {
  constructor(private readonly sinks: LogSink[]) {}

  appendLine(value: string): void {
    for (const sink of this.sinks) {
      sink.appendLine(value);
    }
  }
}
