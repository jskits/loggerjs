import type { LogEvent, Transport, TransportContext } from "../types";
import { toLevelValue } from "../levels";

export type DropPolicy = "drop-oldest" | "drop-newest" | "throw";

export interface BatchTransportOptions {
  name?: string;
  maxBatchSize?: number;
  flushIntervalMs?: number;
  maxQueueSize?: number;
  dropPolicy?: DropPolicy;
  onDrop?: (event: LogEvent, reason: string) => void;
}

export function batchTransport(inner: Transport, options: BatchTransportOptions = {}): Transport {
  const maxBatchSize = options.maxBatchSize ?? 50;
  const flushIntervalMs = options.flushIntervalMs ?? 1000;
  const maxQueueSize = options.maxQueueSize ?? 1000;
  const dropPolicy = options.dropPolicy ?? "drop-oldest";
  const queue: LogEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastContext: TransportContext | undefined;
  let flushing = false;

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };

  const schedule = () => {
    if (timer || flushIntervalMs <= 0) return;
    timer = setTimeout(() => {
      void flush();
    }, flushIntervalMs);
    const maybeNodeTimer = timer as unknown as { unref?: () => void };
    maybeNodeTimer.unref?.();
  };

  const flush = async () => {
    if (flushing || queue.length === 0) return;
    flushing = true;
    clearTimer();
    const batch = queue.splice(0, queue.length);
    const context = lastContext;
    try {
      if (inner.logBatch && context) {
        await inner.logBatch(batch, context);
      } else if (inner.log && context) {
        for (const event of batch) {
          // oxlint-disable-next-line no-await-in-loop -- Preserve transport write order.
          await inner.log(event, context);
        }
      }
    } finally {
      flushing = false;
      if (queue.length > 0) schedule();
    }
  };

  return {
    name: options.name ?? `batch(${inner.name ?? "transport"})`,
    minLevel: inner.minLevel,
    log(event, context) {
      if (inner.minLevel !== undefined && event.level < toLevelValue(inner.minLevel)) return;
      lastContext = context;
      if (queue.length >= maxQueueSize) {
        if (dropPolicy === "drop-newest") {
          options.onDrop?.(event, "queue-full");
          return;
        }
        if (dropPolicy === "drop-oldest") {
          const dropped = queue.shift();
          if (dropped) options.onDrop?.(dropped, "queue-full");
        } else {
          throw new Error(`loggerjs batch transport queue exceeded ${maxQueueSize}`);
        }
      }
      queue.push(event);
      if (queue.length >= maxBatchSize) void flush();
      else schedule();
    },
    async flush() {
      await flush();
      await inner.flush?.();
    },
    async close() {
      await flush();
      await inner.close?.();
    },
  };
}
