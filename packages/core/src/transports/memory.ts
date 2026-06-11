import type { LogEvent, LogRecord, Transport, TransportContext } from "../types";

export interface MemoryTransport extends Transport {
  events: LogEvent[];
  clear: () => void;
}

export function memoryTransport(
  options: { maxEvents?: number; name?: string } = {},
): MemoryTransport {
  const events: LogEvent[] = [];
  const maxEvents = options.maxEvents ?? 1000;
  const append = (event: LogEvent) => {
    events.push(event);
    if (events.length > maxEvents) events.splice(0, events.length - maxEvents);
  };
  const appendRecord = (record: LogRecord, context: TransportContext) => {
    append(context.toEvent(record));
  };

  return {
    name: options.name ?? "memory",
    events,
    clear() {
      events.splice(0, events.length);
    },
    write(record, context) {
      appendRecord(record, context);
    },
    writeBatch(records, context) {
      for (const record of records) appendRecord(record, context);
    },
    log(event) {
      append(event);
    },
    logBatch(batch) {
      for (const event of batch) append(event);
    },
  };
}
