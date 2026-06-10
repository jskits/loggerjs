import type { LogEvent, Processor } from "@loggerjs/core";

export interface DedupeOptions {
  windowMs?: number;
  maxEntries?: number;
  key?: (event: LogEvent) => string;
}

export function dedupeProcessor(options: DedupeOptions = {}): Processor {
  const windowMs = options.windowMs ?? 1000;
  const maxEntries = options.maxEntries ?? 1000;
  const keyFor =
    options.key ?? ((event) => `${event.levelName}:${event.message}:${event.error?.message ?? ""}`);
  const seen = new Map<string, number>();

  return (event, context): LogEvent | false => {
    const now = context.now();
    const key = keyFor(event);
    const previous = seen.get(key);
    if (previous !== undefined && now - previous < windowMs) return false;
    seen.set(key, now);

    if (seen.size > maxEntries) {
      const cutoff = now - windowMs;
      for (const [entryKey, timestamp] of seen) {
        if (timestamp < cutoff || seen.size > maxEntries) seen.delete(entryKey);
      }
    }

    return event;
  };
}
