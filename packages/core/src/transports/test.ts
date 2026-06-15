import type { LogEvent, LogRecord, Transport, TransportContext } from "../types";
import { clearRuntimeTimeout, setRuntimeTimeout, type RuntimeTimerHandle } from "../host";

export type TestTransportMatcher = (event: LogEvent) => boolean;

export interface TestTransportAbortSignal {
  readonly aborted: boolean;
  readonly reason?: unknown;
  addEventListener?: (...args: any[]) => void;
  removeEventListener?: (...args: any[]) => void;
}

export interface TestTransportWaitOptions {
  timeoutMs?: number;
  signal?: TestTransportAbortSignal;
}

export interface TestTransportWaitForCountOptions extends TestTransportWaitOptions {
  matcher?: TestTransportMatcher;
}

export interface TestTransportStats {
  writeCalls: number;
  writeBatchCalls: number;
  logCalls: number;
  logBatchCalls: number;
  flushCalls: number;
  closeCalls: number;
  droppedEvents: number;
}

export interface TestTransportOptions {
  name?: string;
  maxEvents?: number;
  cloneEvent?: (event: LogEvent) => LogEvent;
}

export interface TestTransport extends Transport {
  events: LogEvent[];
  batches: LogEvent[][];
  stats: TestTransportStats;
  clear: () => void;
  reset: () => void;
  failNext: (error?: unknown) => void;
  waitFor: (
    matcher?: TestTransportMatcher,
    options?: TestTransportWaitOptions,
  ) => Promise<LogEvent>;
  waitForCount: (count: number, options?: TestTransportWaitForCountOptions) => Promise<LogEvent[]>;
}

interface Waiter {
  count: number;
  matcher: TestTransportMatcher | undefined;
  resolve: (events: LogEvent[]) => void;
  reject: (error: unknown) => void;
  timer: RuntimeTimerHandle | undefined;
  signal: TestTransportAbortSignal | undefined;
  onAbort: (() => void) | undefined;
}

function defaultTimeoutError(timeoutMs: number, count: number) {
  return new Error(`Timed out after ${timeoutMs}ms waiting for ${count} test transport event(s)`);
}

function abortError(signal: TestTransportAbortSignal) {
  return signal.reason ?? new Error("Test transport wait aborted");
}

function toFailure(error: unknown) {
  return error ?? new Error("Test transport failure");
}

function cleanupWaiter(waiter: Waiter) {
  clearRuntimeTimeout(waiter.timer);
  if (waiter.signal && waiter.onAbort) {
    waiter.signal.removeEventListener?.("abort", waiter.onAbort);
  }
}

export function testTransport(transportOptions: TestTransportOptions = {}): TestTransport {
  const events: LogEvent[] = [];
  const batches: LogEvent[][] = [];
  const waiters: Waiter[] = [];
  const maxEvents = transportOptions.maxEvents ?? 1000;
  const cloneEvent = transportOptions.cloneEvent;
  const stats: TestTransportStats = {
    writeCalls: 0,
    writeBatchCalls: 0,
    logCalls: 0,
    logBatchCalls: 0,
    flushCalls: 0,
    closeCalls: 0,
    droppedEvents: 0,
  };
  let nextFailure: unknown;

  const snapshot = (event: LogEvent) => (cloneEvent ? cloneEvent(event) : event);

  const matches = (waiter: Waiter) => (waiter.matcher ? events.filter(waiter.matcher) : events);

  const removeWaiter = (waiter: Waiter) => {
    const index = waiters.indexOf(waiter);
    if (index >= 0) waiters.splice(index, 1);
  };

  const settleWaiters = () => {
    for (const waiter of waiters.slice()) {
      const found = matches(waiter);
      if (found.length < waiter.count) continue;
      removeWaiter(waiter);
      cleanupWaiter(waiter);
      waiter.resolve(found.slice(0, waiter.count));
    }
  };

  const appendSnapshot = (event: LogEvent) => {
    events.push(event);
    if (events.length > maxEvents) {
      const dropped = events.length - maxEvents;
      events.splice(0, dropped);
      stats.droppedEvents += dropped;
    }
  };

  const appendRecordSnapshot = (record: LogRecord, context: TransportContext) => {
    appendSnapshot(snapshot(context.toEvent(record)));
  };

  const takeFailure = () => {
    const failure = nextFailure;
    nextFailure = undefined;
    if (failure !== undefined) throw toFailure(failure);
  };

  const waitForCount = (
    count: number,
    waitOptions: TestTransportWaitForCountOptions = {},
  ): Promise<LogEvent[]> => {
    if (!Number.isInteger(count) || count < 1) {
      return Promise.reject(new Error("Test transport wait count must be a positive integer"));
    }

    const immediate = waitOptions.matcher ? events.filter(waitOptions.matcher) : events;
    if (immediate.length >= count) return Promise.resolve(immediate.slice(0, count));

    if (waitOptions.signal?.aborted) return Promise.reject(abortError(waitOptions.signal));

    return new Promise<LogEvent[]>((resolve, reject) => {
      const waiter: Waiter = {
        count,
        matcher: waitOptions.matcher,
        resolve,
        reject,
        timer: undefined,
        signal: waitOptions.signal,
        onAbort: undefined,
      };

      const timeoutMs = waitOptions.timeoutMs ?? 1000;
      if (timeoutMs > 0 && Number.isFinite(timeoutMs)) {
        waiter.timer = setRuntimeTimeout(() => {
          removeWaiter(waiter);
          cleanupWaiter(waiter);
          reject(defaultTimeoutError(timeoutMs, count));
        }, timeoutMs);
        if (waiter.timer === undefined) {
          reject(defaultTimeoutError(timeoutMs, count));
          return;
        }
      }

      const signal = waitOptions.signal;
      if (signal) {
        waiter.onAbort = () => {
          removeWaiter(waiter);
          cleanupWaiter(waiter);
          reject(abortError(signal));
        };
        signal.addEventListener?.("abort", waiter.onAbort, { once: true });
      }

      waiters.push(waiter);
    });
  };

  return {
    name: transportOptions.name ?? "test",
    events,
    batches,
    stats,
    clear() {
      events.splice(0, events.length);
      batches.splice(0, batches.length);
    },
    reset() {
      this.clear();
      stats.logCalls = 0;
      stats.logBatchCalls = 0;
      stats.writeCalls = 0;
      stats.writeBatchCalls = 0;
      stats.flushCalls = 0;
      stats.closeCalls = 0;
      stats.droppedEvents = 0;
      nextFailure = undefined;
    },
    failNext(error) {
      nextFailure = toFailure(error);
    },
    waitFor(matcher, waitOptions) {
      return waitForCount(1, { ...waitOptions, matcher }).then((found) => found[0] as LogEvent);
    },
    waitForCount,
    write(record, context) {
      stats.writeCalls += 1;
      takeFailure();
      appendRecordSnapshot(record, context);
      settleWaiters();
    },
    writeBatch(records, context) {
      stats.writeBatchCalls += 1;
      takeFailure();
      const snapshotBatch = records.map((record) => snapshot(context.toEvent(record)));
      batches.push(snapshotBatch);
      for (const event of snapshotBatch) appendSnapshot(event);
      settleWaiters();
    },
    log(event) {
      stats.logCalls += 1;
      takeFailure();
      appendSnapshot(snapshot(event));
      settleWaiters();
    },
    logBatch(batch) {
      stats.logBatchCalls += 1;
      takeFailure();
      const snapshotBatch = batch.map(snapshot);
      batches.push(snapshotBatch);
      for (const event of snapshotBatch) appendSnapshot(event);
      settleWaiters();
    },
    flush() {
      stats.flushCalls += 1;
    },
    async close() {
      stats.closeCalls += 1;
    },
  };
}
