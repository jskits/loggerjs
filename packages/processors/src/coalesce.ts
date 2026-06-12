import { incrementLoggerMetaCounter, type LogEvent, type Processor } from "@loggerjs/core";

export interface CoalesceOptions {
  windowMs?: number;
  maxEntries?: number;
  key?: (event: LogEvent) => string;
  field?: string;
  updateMessage?: boolean;
}

interface CoalesceState {
  firstSeen: number;
  lastSeen: number;
  count: number;
}

function attachCoalesced(
  event: LogEvent,
  field: string,
  key: string,
  state: CoalesceState,
  updateMessage: boolean,
): LogEvent {
  if (state.count <= 1) return event;
  const payload = {
    key,
    count: state.count,
    firstSeen: state.firstSeen,
    lastSeen: state.lastSeen,
  };
  return {
    ...event,
    message: updateMessage ? `${event.message} (x${state.count})` : event.message,
    data:
      event.data && typeof event.data === "object" && !Array.isArray(event.data)
        ? { ...(event.data as Record<string, unknown>), [field]: payload }
        : { value: event.data, [field]: payload },
  };
}

export function coalesceProcessor(options: CoalesceOptions = {}): Processor {
  const windowMs = options.windowMs ?? 1000;
  const maxEntries = options.maxEntries ?? 1000;
  const field = options.field ?? "coalesced";
  const updateMessage = options.updateMessage ?? true;
  const keyFor =
    options.key ?? ((event) => `${event.levelName}:${event.message}:${event.error?.message ?? ""}`);
  const seen = new Map<string, CoalesceState>();

  return (event, context): LogEvent | false => {
    const now = context.now();
    const key = keyFor(event);
    const previous = seen.get(key);

    if (previous && now - previous.lastSeen < windowMs) {
      previous.count += 1;
      previous.lastSeen = now;
      incrementLoggerMetaCounter("processor.coalesce.suppressed");
      return false;
    }

    const next: CoalesceState = {
      firstSeen: now,
      lastSeen: now,
      count: 1,
    };
    seen.set(key, next);

    if (seen.size > maxEntries) {
      const cutoff = now - windowMs;
      for (const [entryKey, state] of seen) {
        if (state.lastSeen < cutoff || seen.size > maxEntries) seen.delete(entryKey);
      }
    }

    return previous ? attachCoalesced(event, field, key, previous, updateMessage) : event;
  };
}
