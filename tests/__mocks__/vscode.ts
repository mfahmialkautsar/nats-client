export class EventEmitter {
  private listeners: ((e: any) => any)[] = [];
  event = (listener: (e: any) => any) => {
    this.listeners.push(listener);
    return {
      dispose: () =>
        (this.listeners = this.listeners.filter((l) => l !== listener)),
    };
  };
  fire(data: any) {
    this.listeners.forEach((l) => l(data));
  }
}
