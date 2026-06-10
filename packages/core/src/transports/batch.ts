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
  maxWaitMs?: number;
  flushIntervalMs?: number;
  maxQueueSize?: number;
  dropPolicy?: DropPolicy;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  random?: () => number;
  circuitBreakerFailureThreshold?: number;
  circuitBreakerResetMs?: number;
  onDrop?: (event: LogEvent, reason: string) => void;
}

export function batchTransport(inner: Transport, options: BatchTransportOptions = {}): Transport {
  const maxBatchSize = options.maxRecords ?? options.maxBatchSize ?? 50;
  const flushIntervalMs = options.maxWaitMs ?? options.flushIntervalMs ?? 1000;
  const maxQueueSize = options.maxQueueSize ?? 1000;
  const dropPolicy = options.dropPolicy ?? "drop-oldest";
  const maxRetries = options.maxRetries ?? 0;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? 100;
  const retryMaxDelayMs = options.retryMaxDelayMs ?? 1000;
  const random = options.random ?? Math.random;
  const circuitBreakerFailureThreshold = options.circuitBreakerFailureThreshold ?? Infinity;
  const circuitBreakerResetMs = options.circuitBreakerResetMs ?? 30_000;
  const queue: LogEvent[] = [];
  const transportName = options.name ?? `batch(${inner.name ?? "transport"})`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastContext: TransportContext | undefined;
  let flushing = false;
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

  const flush = async () => {
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
    const batch = queue.splice(0, queue.length);
    try {
      await deliverWithRetry(batch, context);
    } catch (error) {
      queue.unshift(...batch);
      throw error;
    } finally {
      flushing = false;
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
      if (queue.length >= maxQueueSize) {
        if (dropPolicy === "drop-newest") {
          reportDrop(event, "queue-full", context);
          return;
        }
        if (dropPolicy === "drop-oldest") {
          const dropped = queue.shift();
          if (dropped) reportDrop(dropped, "queue-full", context);
        } else {
          reportDrop(event, "queue-full", context);
          return;
        }
      }
      queue.push(event);
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
