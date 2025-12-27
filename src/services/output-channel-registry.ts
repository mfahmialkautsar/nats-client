import type { LogSink } from "@/services/log-sink";

export interface OutputChannelLike extends LogSink {
  show(preserveFocus?: boolean): void;
  dispose(): void;
}

export type OutputChannelFactory = (label: string) => OutputChannelLike;

interface SubjectEntry {
  channel: OutputChannelLike;
  refCount: number;
  pinned?: boolean;
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

  acquire(
    subject: string,
    key: string,
  ): { channel: OutputChannelLike; isNew: boolean } {
    let entry = this.subjects.get(subject);
    let isNew = false;
    if (!entry) {
      entry = {
        channel: this.factory(`${this.mainLabel} - ${subject}`),
        refCount: 0,
      };
      this.subjects.set(subject, entry);
      isNew = true;
    }
    entry.refCount += 1;
    this.keyToSubject.set(key, subject);
    return { channel: entry.channel, isNew };
  }

  getOrCreate(subject: string): { channel: OutputChannelLike; isNew: boolean } {
    let entry = this.subjects.get(subject);
    let isNew = false;
    if (!entry) {
      entry = {
        channel: this.factory(`${this.mainLabel} - ${subject}`),
        refCount: 0,
        pinned: true,
      };
      this.subjects.set(subject, entry);
      isNew = true;
    } else {
      entry.pinned = true;
    }
    return { channel: entry.channel, isNew };
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
    if (entry.refCount <= 0 && !entry.pinned) {
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
