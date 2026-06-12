import { incrementLoggerMetaCounter } from "../meta";
import { eventToRecord } from "../record";
import type { LogEvent, LogRecord, Transport, TransportContext } from "../types";

export type TransportOperation = "write" | "writeBatch" | "log" | "logBatch";

export type RetryFallbackReason = "primary-error" | "circuit-open";

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
}

export interface FallbackTransportOptions {
  name?: string;
  onFallback?: (detail: { operation: TransportOperation; error: unknown }) => void;
}

type TransportPayload = LogRecord | LogRecord[] | LogEvent | LogEvent[];

const sleep = (delayMs: number) =>
  delayMs <= 0 ? Promise.resolve() : new Promise<void>((resolve) => setTimeout(resolve, delayMs));

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
    if (transport.log) return transport.log(context.toEvent(record), context);
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
    if (transport.write) return transport.write(eventToRecord(event), context);
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
      await deliver(fallback, operation, payload, context);
    }
  };

  return {
    name: transportName,
    minLevel: primary.minLevel,
    write(record, context) {
      return deliverWithFallback("write", record, context);
    },
    writeBatch(records, context) {
      return deliverWithFallback("writeBatch", records, context);
    },
    log(event, context) {
      return deliverWithFallback("log", event, context);
    },
    logBatch(events, context) {
      return deliverWithFallback("logBatch", events, context);
    },
    async flush() {
      await primary.flush?.();
      await fallback.flush?.();
    },
    flushSync() {
      primary.flushSync?.();
      fallback.flushSync?.();
    },
    async close() {
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

  const deliverFallback = async (
    reason: RetryFallbackReason,
    operation: TransportOperation,
    payload: TransportPayload,
    context: TransportContext,
    error?: unknown,
  ) => {
    if (!fallback) {
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
    await deliver(fallback, operation, payload, context);
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
    write(record, context) {
      return deliverWithRetry("write", record, context);
    },
    writeBatch(records, context) {
      return deliverWithRetry("writeBatch", records, context);
    },
    log(event, context) {
      return deliverWithRetry("log", event, context);
    },
    logBatch(events, context) {
      return deliverWithRetry("logBatch", events, context);
    },
    async flush() {
      await inner.flush?.();
      await fallback?.flush?.();
    },
    flushSync() {
      inner.flushSync?.();
      fallback?.flushSync?.();
    },
    async close() {
      await inner.close?.();
      await fallback?.close?.();
    },
  };
}
