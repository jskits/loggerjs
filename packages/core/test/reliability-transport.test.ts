import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRecord,
  fallbackTransport,
  getLoggerMetaStats,
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
