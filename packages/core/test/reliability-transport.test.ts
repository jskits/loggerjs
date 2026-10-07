import { afterEach, describe, expect, it, vi } from "vitest";
import {
  batchTransport,
  createLogger,
  createRecord,
  fallbackTransport,
  getLoggerMetaStats,
  httpStatusError,
  parseRetryAfter,
  recordToEvent,
  resetLoggerMetaStats,
  retryTransport,
  type LogEvent,
  type LogRecord,
  type RetryTransportOptions,
  type Transport,
  type TransportContext,
  type TransportOperation,
} from "../src";

const event: LogEvent = {
  id: "evt-1",
  time: 1,
  seq: 1,
  level: 30,
  levelName: "info",
  logger: "test",
  message: "created",
};

const record = createRecord({
  time: 1,
  level: 30,
  category: "test",
  msg: "created",
  seq: 1,
});

const secondRecord = createRecord({
  time: 2,
  level: 30,
  category: "test",
  msg: "updated",
  seq: 2,
});

function createContext(errors: unknown[] = []): TransportContext {
  return {
    loggerName: "test",
    now: () => 1,
    toEvent: recordToEvent,
    reportInternalError(error) {
      errors.push(error);
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("fallbackTransport", () => {
  it("delivers to the fallback when the primary transport fails", async () => {
    resetLoggerMetaStats();
    const errors: unknown[] = [];
    const primaryError = new Error("primary down");
    const fallbackEvents: LogEvent[] = [];
    const primary: Transport = {
      name: "primary",
      log() {
        throw primaryError;
      },
    };
    const fallback: Transport = {
      name: "fallback",
      log(next) {
        fallbackEvents.push(next);
      },
    };

    await fallbackTransport(primary, fallback).log?.(event, createContext(errors));

    expect(fallbackEvents).toEqual([event]);
    expect(errors).toEqual([primaryError]);
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.fallback": 1,
    });
  });

  it("preserves order when a failed batch falls back to single writes", async () => {
    resetLoggerMetaStats();
    const errors: unknown[] = [];
    const primaryError = new Error("batch down");
    const onFallback = vi.fn<(detail: { operation: TransportOperation; error: unknown }) => void>();
    const primary: Transport = {
      name: "primary",
      writeBatch() {
        throw primaryError;
      },
    };
    const fallbackRecords: number[] = [];
    const fallback: Transport = {
      name: "fallback",
      write(next) {
        fallbackRecords.push(next.seq);
      },
    };

    await fallbackTransport(primary, fallback, { onFallback }).writeBatch?.(
      [record, secondRecord],
      createContext(errors),
    );

    expect(fallbackRecords).toEqual([1, 2]);
    expect(onFallback).toHaveBeenCalledWith({ operation: "writeBatch", error: primaryError });
    expect(errors).toEqual([primaryError]);
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.fallback": 1,
    });
  });

  it("adapts event logs to write-only primary transports", async () => {
    const records: LogRecord[] = [];
    const fallbackLog = vi.fn<NonNullable<Transport["log"]>>();
    const primary: Transport = {
      name: "primary",
      write(next) {
        records.push(next);
      },
    };
    const fallback: Transport = {
      name: "fallback",
      log: fallbackLog,
    };

    await fallbackTransport(primary, fallback).log?.(event, createContext());

    expect(records.map((item) => item.msg)).toEqual(["created"]);
    expect(fallbackLog).not.toHaveBeenCalled();
  });

  it("reports events through onDrop when the fallback fails too", async () => {
    resetLoggerMetaStats();
    const dropped: Array<[string, string]> = [];
    const transport = fallbackTransport(
      {
        name: "remote",
        log() {
          throw new Error("remote down");
        },
      },
      {
        name: "backup",
        log() {
          throw new Error("backup down");
        },
      },
      { onDrop: (droppedEvent, reason) => dropped.push([droppedEvent.id, reason]) },
    );

    await expect(transport.log?.(event, createContext())).rejects.toThrow("backup down");
    expect(dropped).toEqual([["evt-1", "fallback-failed"]]);
    expect(getLoggerMetaStats()["transport.dropped.fallback-failed"]).toBe(1);
  });

  it("delegates lifecycle hooks to primary and fallback transports", async () => {
    const calls: string[] = [];
    const primary: Transport = {
      name: "primary",
      async flush() {
        calls.push("primary:flush");
      },
      flushSync() {
        calls.push("primary:flushSync");
      },
      async close() {
        calls.push("primary:close");
      },
    };
    const fallback: Transport = {
      name: "fallback",
      async flush() {
        calls.push("fallback:flush");
      },
      flushSync() {
        calls.push("fallback:flushSync");
      },
      async close() {
        calls.push("fallback:close");
      },
    };
    const transport = fallbackTransport(primary, fallback);

    await transport.flush?.();
    transport.flushSync?.();
    await transport.close?.();

    expect(calls).toEqual([
      "primary:flush",
      "fallback:flush",
      "primary:flushSync",
      "fallback:flushSync",
      "primary:close",
      "fallback:close",
    ]);
  });
});

describe("retryTransport", () => {
  it("retries with backoff before reporting success", async () => {
    resetLoggerMetaStats();
    const attempts: number[] = [];
    const onRetry = vi.fn<NonNullable<RetryTransportOptions["onRetry"]>>();
    const inner: Transport = {
      name: "remote",
      log() {
        attempts.push(Date.now());
        if (attempts.length === 1) throw new Error("try again");
      },
    };

    await retryTransport(inner, {
      maxRetries: 1,
      retryBaseDelayMs: 0,
      onRetry,
    }).log?.(event, createContext());

    expect(attempts).toHaveLength(2);
    expect(onRetry).toHaveBeenCalledWith({
      attempt: 1,
      delayMs: 0,
      error: expect.any(Error),
    });
    expect(getLoggerMetaStats()).toMatchObject({ "transport.retry": 1 });
  });

  it("waits for backoff time before retrying failed delivery", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    resetLoggerMetaStats();
    const attempts: number[] = [];
    const inner: Transport = {
      name: "remote",
      log() {
        attempts.push(Date.now());
        if (attempts.length === 1) throw new Error("try again");
      },
    };

    const delivery = retryTransport(inner, {
      maxRetries: 1,
      retryBaseDelayMs: 250,
      retryMaxDelayMs: 250,
      random: () => 1,
    }).log?.(event, createContext());

    await Promise.resolve();
    expect(attempts).toEqual([0]);

    await vi.advanceTimersByTimeAsync(249);
    expect(attempts).toEqual([0]);

    await vi.advanceTimersByTimeAsync(1);
    await delivery;

    expect(attempts).toEqual([0, 250]);
    expect(getLoggerMetaStats()).toMatchObject({ "transport.retry": 1 });
  });

  it("opens the circuit and sends subsequent logs directly to fallback", async () => {
    resetLoggerMetaStats();
    const errors: unknown[] = [];
    const primary = {
      name: "remote",
      log: vi.fn<NonNullable<Transport["log"]>>(() => {
        throw new Error("remote down");
      }),
    } satisfies Transport;
    const fallbackEvents: LogEvent[] = [];
    const fallback: Transport = {
      name: "local",
      log(next) {
        fallbackEvents.push(next);
      },
    };
    const transport = retryTransport(primary, {
      maxRetries: 0,
      circuitBreakerFailureThreshold: 1,
      circuitBreakerResetMs: 10_000,
      fallback,
    });
    const context = createContext(errors);

    await transport.log?.(event, context);
    await transport.log?.({ ...event, id: "evt-2", seq: 2 }, context);

    expect(primary.log).toHaveBeenCalledTimes(1);
    expect(fallbackEvents.map((item) => item.id)).toEqual(["evt-1", "evt-2"]);
    expect(errors).toHaveLength(1);
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.retry.exhausted": 1,
      "transport.circuit.open": 1,
      "transport.circuit.skipped": 1,
      "transport.fallback": 2,
    });
  });

  it("throws the primary error when retries exhaust without fallback", async () => {
    resetLoggerMetaStats();
    const primaryError = new Error("remote down");
    const primary: Transport = {
      name: "remote",
      log() {
        throw primaryError;
      },
    };

    await expect(
      retryTransport(primary, { maxRetries: 0 }).log?.(event, createContext()),
    ).rejects.toBe(primaryError);
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.retry.exhausted": 1,
    });
  });

  it("throws a circuit-open error when no fallback can receive skipped logs", async () => {
    resetLoggerMetaStats();
    const primary: Transport = {
      name: "remote",
      log() {
        throw new Error("remote down");
      },
    };
    const transport = retryTransport(primary, {
      maxRetries: 0,
      circuitBreakerFailureThreshold: 1,
      circuitBreakerResetMs: 10_000,
    });

    await expect(transport.log?.(event, createContext())).rejects.toThrow("remote down");
    await expect(
      transport.log?.({ ...event, id: "evt-2", seq: 2 }, createContext()),
    ).rejects.toThrow("loggerjs transport circuit is open: retry(remote)");
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.retry.exhausted": 1,
      "transport.circuit.open": 1,
      "transport.circuit.skipped": 1,
    });
  });

  it("reports each event it gives up on through onDrop and still rejects", async () => {
    resetLoggerMetaStats();
    const dropped: Array<[string, string]> = [];
    const failing: Transport = {
      name: "remote",
      writeBatch() {
        throw new Error("remote down");
      },
    };
    const transport = retryTransport(failing, {
      maxRetries: 1,
      retryBaseDelayMs: 0,
      onDrop: (droppedEvent, reason) => dropped.push([droppedEvent.message, reason]),
    });

    await expect(transport.writeBatch?.([record, secondRecord], createContext())).rejects.toThrow(
      "remote down",
    );

    expect(dropped).toEqual([
      ["created", "retry-exhausted"],
      ["updated", "retry-exhausted"],
    ]);
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.dropped": 2,
      "transport.dropped.retry-exhausted": 2,
    });
  });

  it("reports events skipped by an open circuit and by a failing fallback", async () => {
    resetLoggerMetaStats();
    const dropped: string[] = [];
    const failing: Transport = {
      name: "remote",
      log() {
        throw new Error("remote down");
      },
    };
    const open = retryTransport(failing, {
      maxRetries: 0,
      circuitBreakerFailureThreshold: 1,
      onDrop: (_event, reason) => dropped.push(reason),
    });
    await expect(open.log?.(event, createContext())).rejects.toThrow("remote down");
    await expect(open.log?.(event, createContext())).rejects.toThrow("circuit is open");

    const withFailingFallback = retryTransport(failing, {
      maxRetries: 0,
      fallback: { name: "backup", log: () => Promise.reject(new Error("backup down")) },
      onDrop: (_event, reason) => dropped.push(reason),
    });
    await expect(withFailingFallback.log?.(event, createContext())).rejects.toThrow("backup down");

    expect(dropped).toEqual(["retry-exhausted", "circuit-open", "fallback-failed"]);
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.dropped.circuit-open": 1,
      "transport.dropped.fallback-failed": 1,
    });
  });

  it("counts dropped events without reporting an error when no onDrop is set", async () => {
    resetLoggerMetaStats();
    const errors: unknown[] = [];
    const transport = retryTransport(
      {
        name: "remote",
        log() {
          throw new Error("remote down");
        },
      },
      { maxRetries: 0 },
    );

    await expect(transport.log?.(event, createContext(errors))).rejects.toThrow("remote down");
    expect(errors).toEqual([]);
    expect(getLoggerMetaStats()).toMatchObject({ "transport.dropped.retry-exhausted": 1 });
  });

  it("keeps the delivery error when the onDrop callback throws", async () => {
    const errors: unknown[] = [];
    const details: unknown[] = [];
    const context: TransportContext = {
      ...createContext(errors),
      reportInternalError(error, detail) {
        errors.push(error);
        details.push(detail);
      },
    };
    const transport = retryTransport(
      {
        name: "remote",
        log() {
          throw new Error("remote down");
        },
      },
      {
        maxRetries: 0,
        onDrop() {
          throw new Error("callback failed");
        },
      },
    );

    await expect(transport.log?.(event, context)).rejects.toThrow("remote down");
    expect(errors).toEqual([expect.objectContaining({ message: "callback failed" })]);
    expect(details).toEqual([
      { phase: "transport", transport: "retry(remote)", operation: "onDrop" },
    ]);
  });

  it("keeps the circuit open only until the reset window elapses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    resetLoggerMetaStats();
    let primaryFails = true;
    const primaryEvents: string[] = [];
    const primary: Transport = {
      name: "remote",
      log(next) {
        primaryEvents.push(next.id);
        if (primaryFails) throw new Error("remote down");
      },
    };
    const fallbackEvents: string[] = [];
    const fallback: Transport = {
      name: "local",
      log(next) {
        fallbackEvents.push(next.id);
      },
    };
    const transport = retryTransport(primary, {
      maxRetries: 0,
      circuitBreakerFailureThreshold: 1,
      circuitBreakerResetMs: 1_000,
      fallback,
    });
    const context = createContext();

    await transport.log?.(event, context);
    await transport.log?.({ ...event, id: "evt-2", seq: 2 }, context);

    expect(primaryEvents).toEqual(["evt-1"]);
    expect(fallbackEvents).toEqual(["evt-1", "evt-2"]);

    primaryFails = false;
    await vi.advanceTimersByTimeAsync(1_000);
    await transport.log?.({ ...event, id: "evt-3", seq: 3 }, context);

    expect(primaryEvents).toEqual(["evt-1", "evt-3"]);
    expect(fallbackEvents).toEqual(["evt-1", "evt-2"]);
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.circuit.open": 1,
      "transport.circuit.skipped": 1,
      "transport.fallback": 2,
    });
  });

  it("delivers single log calls to batch-only transports", async () => {
    const batches: string[][] = [];
    const transport = retryTransport(
      {
        name: "batch-only",
        logBatch(events) {
          batches.push(events.map((item) => item.id));
        },
      },
      { maxRetries: 0 },
    );

    await transport.log?.(event, createContext());

    expect(batches).toEqual([["evt-1"]]);
  });
});

function slowInner(delivered: string[]): Transport {
  return {
    name: "slow",
    async log(item) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      delivered.push(item.message);
    },
  };
}

describe("reliability wrapper lifecycle", () => {
  it.each([
    ["retryTransport flush", (inner: Transport) => retryTransport(inner), "flush"],
    ["retryTransport close", (inner: Transport) => retryTransport(inner), "close"],
    [
      "fallbackTransport flush",
      (inner: Transport) => fallbackTransport(inner, { log() {} }),
      "flush",
    ],
    [
      "fallbackTransport close",
      (inner: Transport) => fallbackTransport(inner, { log() {} }),
      "close",
    ],
  ] as const)("%s waits for deliveries already in flight", async (_label, wrap, method) => {
    const delivered: string[] = [];
    const transport = wrap(slowInner(delivered));

    void transport.log?.(event, createContext());
    await transport[method]?.();

    expect(delivered).toEqual(["created"]);
  });
});

describe("wrapper readiness", () => {
  it("forwards ready() through batch, retry, and fallback wrappers", async () => {
    const innerReady = vi.fn<() => Promise<void>>(async () => {});
    const fallbackReady = vi.fn<() => Promise<void>>(async () => {});
    const inner: Transport = { name: "worker", log() {}, ready: innerReady };
    const backup: Transport = { name: "backup", log() {}, ready: fallbackReady };
    const logger = createLogger({
      transports: [
        batchTransport(inner),
        retryTransport(inner, { fallback: backup }),
        fallbackTransport(inner, backup),
      ],
    });

    await logger.ready();

    expect(innerReady).toHaveBeenCalledTimes(3);
    expect(fallbackReady).toHaveBeenCalledTimes(2);
  });

  it("does not add ready() when no wrapped transport has one", () => {
    const inner: Transport = { name: "plain", log() {} };

    expect(batchTransport(inner).ready).toBeUndefined();
    expect(retryTransport(inner).ready).toBeUndefined();
    expect(fallbackTransport(inner, { log() {} }).ready).toBeUndefined();
  });
});

describe("Retry-After", () => {
  it("parses delay-seconds and HTTP-dates", () => {
    const now = Date.UTC(2026, 0, 1);
    expect(parseRetryAfter("120", now)).toBe(120_000);
    expect(parseRetryAfter(" 5 ", now)).toBe(5000);
    expect(parseRetryAfter(new Date(now + 30_000).toUTCString(), now)).toBe(30_000);
    expect(parseRetryAfter(new Date(now - 30_000).toUTCString(), now)).toBe(0);
    expect(parseRetryAfter("soon", now)).toBeUndefined();
    expect(parseRetryAfter(null, now)).toBeUndefined();
  });

  it("builds HTTP status errors that carry the requested delay", () => {
    const limited = httpStatusError(
      "demoTransport",
      new Response(null, { status: 429, headers: { "retry-after": "3" } }),
    );
    expect(limited).toMatchObject({
      message: "demoTransport failed with status 429",
      status: 429,
      retryAfterMs: 3000,
    });
    expect(
      httpStatusError("demoTransport", new Response(null, { status: 500 })),
    ).not.toHaveProperty("retryAfterMs");
  });

  function rateLimited(retryAfterMs: number, failures: number, attempts: number[]): Transport {
    return {
      name: "remote",
      log() {
        attempts.push(Date.now());
        if (attempts.length <= failures) {
          throw Object.assign(new Error("remote rate limited"), { status: 429, retryAfterMs });
        }
      },
      logBatch(events) {
        for (const item of events) this.log?.(item, createContext());
      },
    };
  }

  it("makes retryTransport wait at least the requested delay", async () => {
    const attempts: number[] = [];
    const delays: number[] = [];
    const transport = retryTransport(rateLimited(40, 1, attempts), {
      maxRetries: 2,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 100,
      onRetry: ({ delayMs }) => delays.push(delayMs),
    });

    await transport.log?.(event, createContext());

    expect(attempts).toHaveLength(2);
    expect(delays[0]).toBeGreaterThanOrEqual(40);
    expect(attempts[1]! - attempts[0]!).toBeGreaterThanOrEqual(35);
  });

  it("makes retryTransport wait a requested delay equal to retryMaxDelayMs", async () => {
    const attempts: number[] = [];
    const transport = retryTransport(rateLimited(50, 1, attempts), {
      maxRetries: 2,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 50,
    });

    await transport.log?.(event, createContext());

    expect(attempts).toHaveLength(2);
  });

  it("makes retryTransport give up when the requested delay exceeds retryMaxDelayMs", async () => {
    const attempts: number[] = [];
    const dropped: string[] = [];
    const transport = retryTransport(rateLimited(60_000, 5, attempts), {
      maxRetries: 3,
      retryMaxDelayMs: 1000,
      onDrop: (_event, reason) => dropped.push(reason),
    });

    await expect(transport.log?.(event, createContext())).rejects.toThrow("rate limited");
    expect(attempts).toHaveLength(1);
    expect(dropped).toEqual(["retry-exhausted"]);
  });

  it("makes batchTransport retry inside the flush when Retry-After fits retryMaxDelayMs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    resetLoggerMetaStats();
    const attempts: number[] = [];
    const transport = batchTransport(rateLimited(1000, 1, attempts), {
      maxBatchSize: 10,
      flushIntervalMs: 50,
      maxRetries: 3,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 1000,
    });

    transport.log?.(event, createContext());
    await vi.advanceTimersByTimeAsync(1100);

    expect(attempts).toEqual([50, 1050]);
    expect(getLoggerMetaStats()["transport.retry.deferred"]).toBeUndefined();
    expect(transport.stats().queueDepth).toBe(0);
  });

  it("makes batchTransport hold its queue until a long Retry-After ends", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    resetLoggerMetaStats();
    const attempts: number[] = [];
    const errors: unknown[] = [];
    const transport = batchTransport(rateLimited(10_000, 1, attempts), {
      maxBatchSize: 10,
      flushIntervalMs: 50,
      maxRetries: 3,
      retryMaxDelayMs: 1000,
    });

    transport.log?.(event, createContext(errors));
    await vi.advanceTimersByTimeAsync(60);
    expect(attempts).toEqual([50]);
    expect(getLoggerMetaStats()["transport.retry.deferred"]).toBe(1);

    // An explicit flush inside the window sends nothing.
    await transport.flush?.();
    await vi.advanceTimersByTimeAsync(5000);
    expect(attempts).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(5100);
    expect(attempts).toEqual([50, 10_050]);
    expect(transport.stats().queueDepth).toBe(0);
  });
});
