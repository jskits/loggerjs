import { incrementLoggerMetaCounter } from "../meta";
import { eventToRecord } from "../record";
import type { LogEvent, LogRecord, Transport, TransportContext } from "../types";
import { sleep } from "../host";

export type TransportOperation = "write" | "writeBatch" | "log" | "logBatch";

export type RetryFallbackReason = "primary-error" | "circuit-open";

/**
 * Why a reliability wrapper gave up on events: retries ran out with no
 * fallback, the circuit was open with no fallback, or the fallback failed too.
 */
export type ReliabilityDropReason = "retry-exhausted" | "circuit-open" | "fallback-failed";

export interface RetryTransportOptions {
  name?: string;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  random?: () => number;
  circuitBreakerFailureThreshold?: number;
  circuitBreakerResetMs?: number;
  fallback?: Transport;
  onRetry?: (detail: { attempt: number; delayMs: number; error: unknown }) => void;
  onFallback?: (detail: {
    reason: RetryFallbackReason;
    operation: TransportOperation;
    error?: unknown;
  }) => void;
  /**
   * Called once per event when the wrapper gives up on a delivery. The
   * delivery still rejects. If an outer transport retries rejected deliveries
   * itself, those events can still arrive later.
   */
  onDrop?: (event: LogEvent, reason: ReliabilityDropReason) => void;
}

export interface FallbackTransportOptions {
  name?: string;
  onFallback?: (detail: { operation: TransportOperation; error: unknown }) => void;
  /** Called once per event when both the primary and the fallback fail. */
  onDrop?: (event: LogEvent, reason: ReliabilityDropReason) => void;
}

type TransportPayload = LogRecord | LogRecord[] | LogEvent | LogEvent[];

function retryDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  random: () => number,
): number {
  const cap = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  return cap <= 0 ? 0 : random() * cap;
}

function eventsToRecords(events: readonly LogEvent[]): LogRecord[] {
  return events.map((event) => eventToRecord(event));
}

function recordsToEvents(records: readonly LogRecord[], context: TransportContext): LogEvent[] {
  return records.map((record) => context.toEvent(record));
}

async function deliver(
  transport: Transport,
  operation: TransportOperation,
  payload: TransportPayload,
  context: TransportContext,
): Promise<void> {
  if (operation === "write") {
    const record = payload as LogRecord;
    if (transport.write) return transport.write(record, context);
    if (transport.writeBatch) return transport.writeBatch([record], context);
    if (transport.log) return transport.log(context.toEvent(record), context);
    if (transport.logBatch) return transport.logBatch([context.toEvent(record)], context);
    return;
  }

  if (operation === "writeBatch") {
    const records = payload as LogRecord[];
    if (transport.writeBatch) return transport.writeBatch(records, context);
    if (transport.write) {
      for (const record of records) {
        // oxlint-disable-next-line no-await-in-loop -- Fallback delivery preserves log order.
        await transport.write(record, context);
      }
      return;
    }
    if (transport.logBatch) return transport.logBatch(recordsToEvents(records, context), context);
    if (transport.log) {
      for (const event of recordsToEvents(records, context)) {
        // oxlint-disable-next-line no-await-in-loop -- Fallback delivery preserves log order.
        await transport.log(event, context);
      }
    }
    return;
  }

  if (operation === "log") {
    const event = payload as LogEvent;
    if (transport.log) return transport.log(event, context);
    if (transport.logBatch) return transport.logBatch([event], context);
    if (transport.write) return transport.write(eventToRecord(event), context);
    if (transport.writeBatch) return transport.writeBatch([eventToRecord(event)], context);
    return;
  }

  const events = payload as LogEvent[];
  if (transport.logBatch) return transport.logBatch(events, context);
  if (transport.log) {
    for (const event of events) {
      // oxlint-disable-next-line no-await-in-loop -- Fallback delivery preserves log order.
      await transport.log(event, context);
    }
    return;
  }
  if (transport.writeBatch) return transport.writeBatch(eventsToRecords(events), context);
  if (transport.write) {
    for (const record of eventsToRecords(events)) {
      // oxlint-disable-next-line no-await-in-loop -- Fallback delivery preserves log order.
      await transport.write(record, context);
    }
  }
}

function payloadEvents(
  operation: TransportOperation,
  payload: TransportPayload,
  context: TransportContext,
): LogEvent[] {
  if (operation === "write") return [context.toEvent(payload as LogRecord)];
  if (operation === "writeBatch") return recordsToEvents(payload as LogRecord[], context);
  if (operation === "log") return [payload as LogEvent];
  return payload as LogEvent[];
}

// Counts given-up events like batchTransport does and hands each one to the
// caller's onDrop, without letting a throwing callback replace the delivery
// error the caller is about to see.
function reportDrop(
  transportName: string,
  operation: TransportOperation,
  payload: TransportPayload,
  context: TransportContext,
  reason: ReliabilityDropReason,
  onDrop: ((event: LogEvent, reason: ReliabilityDropReason) => void) | undefined,
) {
  const events = payloadEvents(operation, payload, context);
  incrementLoggerMetaCounter("transport.dropped", events.length);
  incrementLoggerMetaCounter(`transport.dropped.${reason}`, events.length);
  if (!onDrop) return;
  for (const event of events) {
    try {
      onDrop(event, reason);
    } catch (error) {
      context.reportInternalError(error, {
        phase: "transport",
        transport: transportName,
        operation: "onDrop",
      });
    }
  }
}

// Tracks deliveries that have started but not settled, so flush() and close()
// on a wrapper wait for them even when called directly rather than through a
// logger.
function inFlightTracker() {
  const pending = new Set<Promise<void>>();
  return {
    track(delivery: Promise<void>): Promise<void> {
      pending.add(delivery);
      const settle = () => {
        pending.delete(delivery);
      };
      delivery.then(settle, settle);
      return delivery;
    },
    async settle() {
      if (pending.size > 0) await Promise.allSettled(pending);
    },
  };
}

function reportFallback(
  context: TransportContext,
  transportName: string,
  operation: TransportOperation,
  fallback: Transport,
  error: unknown,
) {
  incrementLoggerMetaCounter("transport.fallback");
  context.reportInternalError(error, {
    phase: "transport",
    transport: transportName,
    operation,
    fallback: fallback.name,
  });
}

export function fallbackTransport(
  primary: Transport,
  fallback: Transport,
  options: FallbackTransportOptions = {},
): Transport {
  const transportName = options.name ?? `fallback(${primary.name ?? "primary"})`;
  const inFlight = inFlightTracker();

  const deliverWithFallback = async (
    operation: TransportOperation,
    payload: TransportPayload,
    context: TransportContext,
  ) => {
    try {
      await deliver(primary, operation, payload, context);
    } catch (error) {
      options.onFallback?.({ operation, error });
      reportFallback(context, primary.name ?? transportName, operation, fallback, error);
      try {
        await deliver(fallback, operation, payload, context);
      } catch (fallbackError) {
        reportDrop(transportName, operation, payload, context, "fallback-failed", options.onDrop);
        throw fallbackError;
      }
    }
  };

  return {
    name: transportName,
    minLevel: primary.minLevel,
    ready:
      primary.ready || fallback.ready
        ? async () => {
            await Promise.all([primary.ready?.(), fallback.ready?.()]);
          }
        : undefined,
    write(record, context) {
      return inFlight.track(deliverWithFallback("write", record, context));
    },
    writeBatch(records, context) {
      return inFlight.track(deliverWithFallback("writeBatch", records, context));
    },
    log(event, context) {
      return inFlight.track(deliverWithFallback("log", event, context));
    },
    logBatch(events, context) {
      return inFlight.track(deliverWithFallback("logBatch", events, context));
    },
    async flush() {
      await inFlight.settle();
      await primary.flush?.();
      await fallback.flush?.();
    },
    flushSync() {
      primary.flushSync?.();
      fallback.flushSync?.();
    },
    async close() {
      await inFlight.settle();
      await primary.close?.();
      await fallback.close?.();
    },
  };
}

export function retryTransport(inner: Transport, options: RetryTransportOptions = {}): Transport {
  const maxRetries = options.maxRetries ?? 1;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? 100;
  const retryMaxDelayMs = options.retryMaxDelayMs ?? 1000;
  const random = options.random ?? Math.random;
  const circuitBreakerFailureThreshold = options.circuitBreakerFailureThreshold ?? Infinity;
  const circuitBreakerResetMs = options.circuitBreakerResetMs ?? 30_000;
  const fallback = options.fallback;
  const transportName = options.name ?? `retry(${inner.name ?? "transport"})`;
  let consecutiveFailures = 0;
  let circuitOpenUntil = 0;
  const inFlight = inFlightTracker();

  const deliverFallback = async (
    reason: RetryFallbackReason,
    operation: TransportOperation,
    payload: TransportPayload,
    context: TransportContext,
    error?: unknown,
  ) => {
    if (!fallback) {
      const dropReason = reason === "circuit-open" ? "circuit-open" : "retry-exhausted";
      reportDrop(transportName, operation, payload, context, dropReason, options.onDrop);
      throw error ?? new Error(`loggerjs transport circuit is open: ${transportName}`);
    }
    incrementLoggerMetaCounter("transport.fallback");
    options.onFallback?.({ reason, operation, error });
    if (error !== undefined) {
      context.reportInternalError(error, {
        phase: "transport",
        transport: inner.name ?? transportName,
        operation,
        fallback: fallback.name,
      });
    }
    try {
      await deliver(fallback, operation, payload, context);
    } catch (fallbackError) {
      reportDrop(transportName, operation, payload, context, "fallback-failed", options.onDrop);
      throw fallbackError;
    }
  };

  const deliverWithRetry = async (
    operation: TransportOperation,
    payload: TransportPayload,
    context: TransportContext,
  ) => {
    const now = Date.now();
    if (circuitOpenUntil > now) {
      incrementLoggerMetaCounter("transport.circuit.skipped");
      await deliverFallback("circuit-open", operation, payload, context);
      return;
    }

    for (let attempt = 0; ; attempt += 1) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- Retry attempts must run sequentially.
        await deliver(inner, operation, payload, context);
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
          // oxlint-disable-next-line no-await-in-loop -- Fallback delivery belongs to the failed attempt.
          await deliverFallback("primary-error", operation, payload, context, error);
          return;
        }

        const delayMs = retryDelay(attempt, retryBaseDelayMs, retryMaxDelayMs, random);
        incrementLoggerMetaCounter("transport.retry");
        options.onRetry?.({ attempt: attempt + 1, delayMs, error });
        // oxlint-disable-next-line no-await-in-loop -- Backoff must complete before the next retry.
        await sleep(delayMs);
      }
    }
  };

  return {
    name: transportName,
    minLevel: inner.minLevel,
    ready:
      inner.ready || fallback?.ready
        ? async () => {
            await Promise.all([inner.ready?.(), fallback?.ready?.()]);
          }
        : undefined,
    write(record, context) {
      return inFlight.track(deliverWithRetry("write", record, context));
    },
    writeBatch(records, context) {
      return inFlight.track(deliverWithRetry("writeBatch", records, context));
    },
    log(event, context) {
      return inFlight.track(deliverWithRetry("log", event, context));
    },
    logBatch(events, context) {
      return inFlight.track(deliverWithRetry("logBatch", events, context));
    },
    async flush() {
      await inFlight.settle();
      await inner.flush?.();
      await fallback?.flush?.();
    },
    flushSync() {
      inner.flushSync?.();
      fallback?.flushSync?.();
    },
    async close() {
      await inFlight.settle();
      await inner.close?.();
      await fallback?.close?.();
    },
  };
}
