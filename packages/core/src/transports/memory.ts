import type { LogEvent, Transport } from "../types";

export interface MemoryTransport extends Transport {
  events: LogEvent[];
  clear: () => void;
}

export function memoryTransport(options: { maxEvents?: number; name?: string } = {}): MemoryTransport {
  const events: LogEvent[] = [];
  const maxEvents = options.maxEvents ?? 1000;
  return {
    name: options.name ?? "memory",
    events,
    clear() {
      events.splice(0, events.length);
    },
    log(event) {
      events.push(event);
      if (events.length > maxEvents) events.splice(0, events.length - maxEvents);
    }
  };
}
