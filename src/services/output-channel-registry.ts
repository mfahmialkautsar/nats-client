import type { LogSink } from "@/services/log-sink";

export interface OutputChannelLike extends LogSink {
  show(preserveFocus?: boolean): void;
  dispose(): void;
}

export type OutputChannelFactory = (label: string) => OutputChannelLike;

interface SubjectEntry {
  channel: OutputChannelLike;
  refCount: number;
}

export class OutputChannelRegistry {
  private mainChannel?: OutputChannelLike;
  private readonly subjects = new Map<string, SubjectEntry>();
  private readonly keyToSubject = new Map<string, string>();

  constructor(
    private readonly factory: OutputChannelFactory,
    private readonly mainLabel = "NATS",
  ) {}

  main(): OutputChannelLike {
    if (!this.mainChannel) {
      this.mainChannel = this.factory(this.mainLabel);
    }
    return this.mainChannel;
  }

  acquire(subject: string, key: string): OutputChannelLike {
    let entry = this.subjects.get(subject);
    if (!entry) {
      entry = {
        channel: this.factory(`${this.mainLabel} - ${subject}`),
        refCount: 0,
      };
      this.subjects.set(subject, entry);
    }
    entry.refCount += 1;
    this.keyToSubject.set(key, subject);
    return entry.channel;
  }

  release(key: string): void {
    const subject = this.keyToSubject.get(key);
    if (!subject) {
      return;
    }
    this.keyToSubject.delete(key);
    const entry = this.subjects.get(subject);
    if (!entry) {
      return;
    }
    entry.refCount -= 1;
    if (entry.refCount <= 0) {
      entry.channel.dispose();
      this.subjects.delete(subject);
    }
  }

  disposeAll(): void {
    this.keyToSubject.clear();
    for (const entry of Array.from(this.subjects.values())) {
      entry.channel.dispose();
    }
    this.subjects.clear();
    if (this.mainChannel) {
      this.mainChannel.dispose();
      this.mainChannel = undefined;
    }
  }
}
