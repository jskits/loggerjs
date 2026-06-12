import { eventToRecord } from "../record";
import type { LogEvent, LogRecord, Transport, TransportContext } from "../types";
import { incrementLoggerMetaCounter, setLoggerMetaGauge } from "../meta";
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
  estimateRecordBytes?: (record: LogRecord) => number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  random?: () => number;
  circuitBreakerFailureThreshold?: number;
  circuitBreakerResetMs?: number;
  onDrop?: (event: LogEvent, reason: string) => void;
}

export interface BatchTransportStats {
  queueDepth: number;
  maxQueueDepth: number;
  activeBatches: number;
  flushes: number;
  flushErrors: number;
  lastFlushBatchSize: number;
  lastFlushDurationMs: number;
  retryCount: number;
  retryExhausted: number;
  circuitOpen: boolean;
  circuitOpenUntil: number;
}

export interface BatchTransport extends Transport {
  stats: () => BatchTransportStats;
}

interface QueueItem {
  payload: LogEvent | LogRecord;
  kind: "event" | "record";
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

export function estimateLogRecordBytes(record: LogRecord): number {
  return estimateValueBytes(record);
}

function toEventBatch(batch: QueueItem[], context: TransportContext): LogEvent[] {
  return batch.map((item) =>
    item.kind === "event" ? (item.payload as LogEvent) : context.toEvent(item.payload as LogRecord),
  );
}

function toRecordBatch(batch: QueueItem[]): LogRecord[] {
  return batch.map((item) =>
    item.kind === "record" ? (item.payload as LogRecord) : eventToRecord(item.payload as LogEvent),
  );
}

function eventForQueueItem(item: QueueItem, context: TransportContext): LogEvent {
  return item.kind === "event"
    ? (item.payload as LogEvent)
    : context.toEvent(item.payload as LogRecord);
}

function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

export function batchTransport(
  inner: Transport,
  options: BatchTransportOptions = {},
): BatchTransport {
  const maxBatchSize = options.maxRecords ?? options.maxBatchSize ?? 50;
  const maxBytes = options.maxBytes ?? Number.POSITIVE_INFINITY;
  const flushIntervalMs = options.maxWaitMs ?? options.flushIntervalMs ?? 1000;
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 1));
  const maxQueueSize = options.maxQueueSize ?? 1000;
  const dropPolicy = options.dropPolicy ?? "drop-oldest";
  const estimateEventBytes = options.estimateEventBytes ?? estimateLogEventBytes;
  const estimateRecordBytes = options.estimateRecordBytes ?? estimateLogRecordBytes;
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
  const statsState: BatchTransportStats = {
    queueDepth: 0,
    maxQueueDepth: 0,
    activeBatches: 0,
    flushes: 0,
    flushErrors: 0,
    lastFlushBatchSize: 0,
    lastFlushDurationMs: 0,
    retryCount: 0,
    retryExhausted: 0,
    circuitOpen: false,
    circuitOpenUntil: 0,
  };

  const updateQueueDepth = () => {
    statsState.queueDepth = queue.length;
    statsState.maxQueueDepth = Math.max(statsState.maxQueueDepth, queue.length);
    setLoggerMetaGauge(`transport.queue.depth.${transportName}`, queue.length);
  };

  const updateCircuit = () => {
    const open = circuitOpenUntil > Date.now();
    statsState.circuitOpen = open;
    statsState.circuitOpenUntil = open ? circuitOpenUntil : 0;
    setLoggerMetaGauge(`transport.circuit.open.${transportName}`, open ? 1 : 0);
  };

  const snapshotStats = (): BatchTransportStats => ({
    ...statsState,
    queueDepth: queue.length,
    circuitOpen: circuitOpenUntil > Date.now(),
    circuitOpenUntil: circuitOpenUntil > Date.now() ? circuitOpenUntil : 0,
  });

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

  const deliverEvents = async (batch: LogEvent[], context: TransportContext) => {
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

  const deliverRecords = async (batch: LogRecord[], context: TransportContext) => {
    if (inner.writeBatch) {
      await inner.writeBatch(batch, context);
      return;
    }

    if (inner.write) {
      for (const record of batch) {
        // oxlint-disable-next-line no-await-in-loop -- Preserve transport write order.
        await inner.write(record, context);
      }
    }
  };

  const deliver = async (batch: QueueItem[], context: TransportContext) => {
    const recordsOnly = batch.every((item) => item.kind === "record");
    const eventsOnly = batch.every((item) => item.kind === "event");

    if (recordsOnly && (inner.writeBatch || inner.write)) {
      await deliverRecords(toRecordBatch(batch), context);
      return;
    }

    if (eventsOnly && (inner.logBatch || inner.log)) {
      await deliverEvents(toEventBatch(batch, context), context);
      return;
    }

    if (inner.writeBatch || inner.write) {
      await deliverRecords(toRecordBatch(batch), context);
      return;
    }

    await deliverEvents(toEventBatch(batch, context), context);
  };

  const deliverWithRetry = async (batch: QueueItem[], context: TransportContext) => {
    for (let attempt = 0; ; attempt++) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- Retry attempts must run sequentially.
        await deliver(batch, context);
        consecutiveFailures = 0;
        return;
      } catch (error) {
        if (attempt >= maxRetries) {
          consecutiveFailures += 1;
          statsState.retryExhausted += 1;
          incrementLoggerMetaCounter("transport.retry.exhausted");
          if (consecutiveFailures >= circuitBreakerFailureThreshold) {
            circuitOpenUntil = Date.now() + circuitBreakerResetMs;
            updateCircuit();
            incrementLoggerMetaCounter("transport.circuit.open");
          }
          throw error;
        }
        statsState.retryCount += 1;
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

    updateQueueDepth();
    return batch;
  };

  const deliverBatchItems = async (batchItems: QueueItem[], context: TransportContext) => {
    try {
      statsState.activeBatches += 1;
      statsState.lastFlushBatchSize = batchItems.length;
      setLoggerMetaGauge(`transport.active_batches.${transportName}`, statsState.activeBatches);
      await deliverWithRetry(batchItems, context);
    } catch (error) {
      queue.unshift(...batchItems);
      updateQueueDepth();
      throw error;
    } finally {
      statsState.activeBatches -= 1;
      setLoggerMetaGauge(`transport.active_batches.${transportName}`, statsState.activeBatches);
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
    const startedAt = nowMs();
    activeFlush = flushLoop(context);
    try {
      await activeFlush;
      statsState.flushes += 1;
    } catch (error) {
      statsState.flushErrors += 1;
      throw error;
    } finally {
      statsState.lastFlushDurationMs = nowMs() - startedAt;
      setLoggerMetaGauge(
        `transport.flush.duration_ms.${transportName}`,
        statsState.lastFlushDurationMs,
      );
      updateCircuit();
      flushing = false;
      activeFlush = undefined;
      if (queue.length > 0) {
        const delay =
          circuitOpenUntil > Date.now() ? circuitOpenUntil - Date.now() : flushIntervalMs;
        schedule(delay);
      }
    }
  };

  const reportDrop = (item: QueueItem, reason: string, context: TransportContext) => {
    incrementLoggerMetaCounter("transport.dropped");
    incrementLoggerMetaCounter(`transport.dropped.${reason}`);
    // Drops happen under overload; only pay for the record-to-event
    // conversion when a drop listener actually consumes it.
    if (options.onDrop) options.onDrop(eventForQueueItem(item, context), reason);
    if (dropPolicy === "throw") {
      context.reportInternalError(new Error(`loggerjs batch transport dropped log: ${reason}`), {
        phase: "transport",
        transport: transportName,
        reason,
      });
    }
  };

  const enqueue = (item: QueueItem, context: TransportContext) => {
    lastContext = context;
    if (item.estimatedBytes > maxBytes) {
      reportDrop(item, "record-too-large", context);
      return;
    }
    if (queue.length >= maxQueueSize) {
      if (dropPolicy === "drop-newest") {
        reportDrop(item, "queue-full", context);
        return;
      }
      if (dropPolicy === "drop-oldest") {
        const dropped = queue.shift();
        if (dropped) reportDrop(dropped, "queue-full", context);
      } else {
        reportDrop(item, "queue-full", context);
        return;
      }
    }
    queue.push(item);
    updateQueueDepth();
    if (queue.length >= maxBatchSize) flushAndReport(context);
    else schedule();
  };

  // Byte estimation walks the entire payload tree, but its result is only
  // consulted by the maxBytes budget checks. With the default unbounded
  // maxBytes those checks can never trigger, so skip the walk entirely.
  const needsByteEstimates = Number.isFinite(maxBytes);

  const enqueueRecord = (record: LogRecord, context: TransportContext) => {
    if (inner.minLevel !== undefined && record.level < toLevelValue(inner.minLevel)) return;
    enqueue(
      {
        payload: record,
        kind: "record",
        estimatedBytes: needsByteEstimates ? estimateRecordBytes(record) : 0,
      },
      context,
    );
  };

  const enqueueEvent = (event: LogEvent, context: TransportContext) => {
    if (inner.minLevel !== undefined && event.level < toLevelValue(inner.minLevel)) return;
    enqueue(
      {
        payload: event,
        kind: "event",
        estimatedBytes: needsByteEstimates ? estimateEventBytes(event) : 0,
      },
      context,
    );
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
    write(record, context) {
      enqueueRecord(record, context);
    },
    writeBatch(records, context) {
      for (const record of records) {
        enqueueRecord(record, context);
      }
    },
    log(event, context) {
      enqueueEvent(event, context);
    },
    logBatch(events, context) {
      for (const event of events) {
        enqueueEvent(event, context);
      }
    },
    async flush() {
      await flush();
      await inner.flush?.();
    },
    async close() {
      await flush();
      await inner.close?.();
    },
    stats() {
      return snapshotStats();
    },
  };
}
