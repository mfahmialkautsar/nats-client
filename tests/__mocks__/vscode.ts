export class EventEmitter<T = unknown> {
  private listeners: ((e: T) => unknown)[] = [];
  event = (listener: (e: T) => unknown) => {
    this.listeners.push(listener);
    return {
      dispose: () =>
        (this.listeners = this.listeners.filter((l) => l !== listener)),
    };
  };
  fire(data: T) {
    this.listeners.forEach((l) => l(data));
  }
}
