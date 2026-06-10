import type { LogEvent, Transport, TransportContext } from "../types";
import { incrementLoggerMetaCounter } from "../meta";
import { toLevelValue } from "../levels";

export type DropPolicy = "drop-oldest" | "drop-newest" | "throw";

const sleep = (delayMs: number) =>
  delayMs <= 0 ? Promise.resolve() : new Promise<void>((resolve) => setTimeout(resolve, delayMs));

export interface BatchTransportOptions {
  name?: string;
  maxRecords?: number;
  maxBatchSize?: number;
  maxBytes?: number;
  maxWaitMs?: number;
  flushIntervalMs?: number;
  concurrency?: number;
  maxQueueSize?: number;
  dropPolicy?: DropPolicy;
  estimateEventBytes?: (event: LogEvent) => number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  random?: () => number;
  circuitBreakerFailureThreshold?: number;
  circuitBreakerResetMs?: number;
  onDrop?: (event: LogEvent, reason: string) => void;
}

interface QueueItem {
  event: LogEvent;
  estimatedBytes: number;
}

const MAX_ESTIMATE_DEPTH = 4;
const MAX_ESTIMATE_KEYS = 64;

function estimateUtf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

function estimateValueBytes(
  value: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): number {
  if (value === null) return 4;

  switch (typeof value) {
    case "string":
      return estimateUtf8ByteLength(value) + 2;
    case "number":
      return Number.isFinite(value) ? 8 : 4;
    case "boolean":
      return value ? 4 : 5;
    case "bigint":
      return value.toString().length + 2;
    case "undefined":
    case "function":
    case "symbol":
      return 0;
    case "object":
      break;
  }

  if (seen.has(value)) return 16;
  if (depth >= MAX_ESTIMATE_DEPTH) return 32;
  seen.add(value);

  if (Array.isArray(value)) {
    let bytes = 2;
    const limit = Math.min(value.length, MAX_ESTIMATE_KEYS);
    for (let index = 0; index < limit; index++) {
      bytes += estimateValueBytes(value[index], depth + 1, seen) + 1;
    }
    return bytes + Math.max(0, value.length - limit) * 8;
  }

  let bytes = 2;
  let count = 0;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (count >= MAX_ESTIMATE_KEYS) {
      bytes += 64;
      break;
    }
    bytes += estimateUtf8ByteLength(key) + 3 + estimateValueBytes(item, depth + 1, seen);
    count += 1;
  }
  return bytes;
}

export function estimateLogEventBytes(event: LogEvent): number {
  return estimateValueBytes(event);
}

export function batchTransport(inner: Transport, options: BatchTransportOptions = {}): Transport {
  const maxBatchSize = options.maxRecords ?? options.maxBatchSize ?? 50;
  const maxBytes = options.maxBytes ?? Number.POSITIVE_INFINITY;
  const flushIntervalMs = options.maxWaitMs ?? options.flushIntervalMs ?? 1000;
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 1));
  const maxQueueSize = options.maxQueueSize ?? 1000;
  const dropPolicy = options.dropPolicy ?? "drop-oldest";
  const estimateEventBytes = options.estimateEventBytes ?? estimateLogEventBytes;
  const maxRetries = options.maxRetries ?? 0;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? 100;
  const retryMaxDelayMs = options.retryMaxDelayMs ?? 1000;
  const random = options.random ?? Math.random;
  const circuitBreakerFailureThreshold = options.circuitBreakerFailureThreshold ?? Infinity;
  const circuitBreakerResetMs = options.circuitBreakerResetMs ?? 30_000;
  const queue: QueueItem[] = [];
  const transportName = options.name ?? `batch(${inner.name ?? "transport"})`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastContext: TransportContext | undefined;
  let flushing = false;
  let activeFlush: Promise<void> | undefined;
  let consecutiveFailures = 0;
  let circuitOpenUntil = 0;

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };

  const schedule = (delayMs = flushIntervalMs) => {
    if (timer || delayMs <= 0) return;
    timer = setTimeout(() => {
      const context = lastContext;
      void flush().catch((error: unknown) => {
        context?.reportInternalError(error, {
          phase: "transport",
          transport: transportName,
          operation: "flush",
        });
      });
    }, delayMs);
    const maybeNodeTimer = timer as unknown as { unref?: () => void };
    maybeNodeTimer.unref?.();
  };

  const retryDelay = (attempt: number): number => {
    const cap = Math.min(retryMaxDelayMs, retryBaseDelayMs * 2 ** attempt);
    return cap <= 0 ? 0 : random() * cap;
  };

  const deliver = async (batch: LogEvent[], context: TransportContext) => {
    if (inner.logBatch) {
      await inner.logBatch(batch, context);
      return;
    }

    if (inner.log) {
      for (const event of batch) {
        // oxlint-disable-next-line no-await-in-loop -- Preserve transport write order.
        await inner.log(event, context);
      }
    }
  };

  const deliverWithRetry = async (batch: LogEvent[], context: TransportContext) => {
    for (let attempt = 0; ; attempt++) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- Retry attempts must run sequentially.
        await deliver(batch, context);
        consecutiveFailures = 0;
        return;
      } catch (error) {
        if (attempt >= maxRetries) {
          consecutiveFailures += 1;
          incrementLoggerMetaCounter("transport.retry.exhausted");
          if (consecutiveFailures >= circuitBreakerFailureThreshold) {
            circuitOpenUntil = Date.now() + circuitBreakerResetMs;
            incrementLoggerMetaCounter("transport.circuit.open");
          }
          throw error;
        }
        incrementLoggerMetaCounter("transport.retry");
        // oxlint-disable-next-line no-await-in-loop -- Backoff must complete before the next retry.
        await sleep(retryDelay(attempt));
      }
    }
  };

  const takeBatch = (): QueueItem[] => {
    const batch: QueueItem[] = [];
    let bytes = 0;

    while (queue.length > 0 && batch.length < maxBatchSize) {
      const next = queue[0];
      if (!next) break;
      if (batch.length > 0 && bytes + next.estimatedBytes > maxBytes) break;
      const item = queue.shift();
      if (!item) break;
      batch.push(item);
      bytes += item.estimatedBytes;
    }

    return batch;
  };

  const deliverBatchItems = async (batchItems: QueueItem[], context: TransportContext) => {
    const batch = batchItems.map((item) => item.event);
    try {
      await deliverWithRetry(batch, context);
    } catch (error) {
      queue.unshift(...batchItems);
      throw error;
    }
  };

  const flushLoop = async (context: TransportContext) => {
    const inFlight = new Set<Promise<void>>();

    const launchAvailableBatches = () => {
      while (queue.length > 0 && inFlight.size < concurrency) {
        const now = Date.now();
        if (circuitOpenUntil > now) {
          schedule(circuitOpenUntil - now);
          return;
        }
        const batchItems = takeBatch();
        if (batchItems.length === 0) return;
        let task: Promise<void>;
        task = deliverBatchItems(batchItems, context).finally(() => {
          inFlight.delete(task);
        });
        inFlight.add(task);
      }
    };

    while (queue.length > 0 || inFlight.size > 0) {
      launchAvailableBatches();
      if (inFlight.size === 0) return;

      try {
        // oxlint-disable-next-line no-await-in-loop -- Wait for a delivery slot before launching more batches.
        await Promise.race(inFlight);
      } catch (error) {
        // oxlint-disable-next-line no-await-in-loop -- Drain active deliveries before surfacing the first failure.
        await Promise.allSettled(inFlight);
        throw error;
      }
    }
  };

  const flush = async () => {
    if (activeFlush) return activeFlush;
    if (flushing || queue.length === 0) return;
    const context = lastContext;
    if (!context) return;

    const now = Date.now();
    if (circuitOpenUntil > now) {
      schedule(circuitOpenUntil - now);
      return;
    }

    flushing = true;
    clearTimer();
    activeFlush = flushLoop(context);
    try {
      await activeFlush;
    } finally {
      flushing = false;
      activeFlush = undefined;
      if (queue.length > 0) {
        const delay =
          circuitOpenUntil > Date.now() ? circuitOpenUntil - Date.now() : flushIntervalMs;
        schedule(delay);
      }
    }
  };

  const reportDrop = (event: LogEvent, reason: string, context: TransportContext) => {
    incrementLoggerMetaCounter("transport.dropped");
    incrementLoggerMetaCounter(`transport.dropped.${reason}`);
    options.onDrop?.(event, reason);
    if (dropPolicy === "throw") {
      context.reportInternalError(new Error(`loggerjs batch transport dropped log: ${reason}`), {
        phase: "transport",
        transport: transportName,
        reason,
      });
    }
  };

  const flushAndReport = (context: TransportContext) => {
    void flush().catch((error: unknown) => {
      context.reportInternalError(error, {
        phase: "transport",
        transport: transportName,
        operation: "flush",
      });
    });
  };

  return {
    name: transportName,
    minLevel: inner.minLevel,
    log(event, context) {
      if (inner.minLevel !== undefined && event.level < toLevelValue(inner.minLevel)) return;
      lastContext = context;
      const estimatedBytes = estimateEventBytes(event);
      if (estimatedBytes > maxBytes) {
        reportDrop(event, "record-too-large", context);
        return;
      }
      if (queue.length >= maxQueueSize) {
        if (dropPolicy === "drop-newest") {
          reportDrop(event, "queue-full", context);
          return;
        }
        if (dropPolicy === "drop-oldest") {
          const dropped = queue.shift();
          if (dropped) reportDrop(dropped.event, "queue-full", context);
        } else {
          reportDrop(event, "queue-full", context);
          return;
        }
      }
      queue.push({ event, estimatedBytes });
      if (queue.length >= maxBatchSize) flushAndReport(context);
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
