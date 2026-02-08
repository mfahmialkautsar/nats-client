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

function appendLogItem(
  sink: LogSink,
  item: LogItem,
  baseIndent: string,
  childIndent: string,
  leafIndent: string,
): void {
  sink.appendLine(`${baseIndent}${item.title}:`);

  if (item.headers && Object.keys(item.headers).length > 0) {
    sink.appendLine(`${childIndent}Headers:`);
    for (const [hk, hv] of Object.entries(item.headers)) {
      sink.appendLine(`${leafIndent}${hk}: ${hv}`);
    }
  }

  const body = item.body ?? "";
  sink.appendLine(childIndent + "Body:");
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    sink.appendLine(leafIndent + line);
  }
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
    block.meta && Object.hasOwn(block.meta, "timestamp")
      ? String(block.meta["timestamp"])
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
    appendLogItem(sink, item, baseIndent, childIndent, leafIndent);
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
