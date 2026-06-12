import { describe, expect, it, vi } from "vitest";
import {
  fallbackTransport,
  getLoggerMetaStats,
  recordToEvent,
  resetLoggerMetaStats,
  retryTransport,
  type LogEvent,
  type RetryTransportOptions,
  type Transport,
  type TransportContext,
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
