import { describe, expect, it, vi } from "vitest";
import {
  batchTransport,
  getLoggerMetaStats,
  recordToEvent,
  resetLoggerMetaStats,
  type LogEvent,
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

describe("batchTransport", () => {
  it("counts dropped newest events without throwing", () => {
    resetLoggerMetaStats();
    const dropped: LogEvent[] = [];
    const transport = batchTransport(
      {
        name: "inner",
        logBatch() {},
      },
      {
        maxBatchSize: 10,
        maxQueueSize: 1,
        flushIntervalMs: 0,
        dropPolicy: "drop-newest",
        onDrop(droppedEvent) {
          dropped.push(droppedEvent);
        },
      },
    );

    const context = createContext();
    transport.log?.(event, context);
    expect(() => transport.log?.({ ...event, id: "evt-2", seq: 2 }, context)).not.toThrow();

    expect(dropped.map((item) => item.id)).toEqual(["evt-2"]);
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.dropped": 1,
      "transport.dropped.queue-full": 1,
    });
  });

  it("reports legacy throw overflow policy instead of throwing into the app", () => {
    resetLoggerMetaStats();
    const errors: unknown[] = [];
    const transport = batchTransport(
      {
        name: "inner",
        logBatch() {},
      },
      {
        maxBatchSize: 10,
        maxQueueSize: 1,
        flushIntervalMs: 0,
        dropPolicy: "throw",
      },
    );

    const context = createContext(errors);
    transport.log?.(event, context);
    expect(() => transport.log?.({ ...event, id: "evt-2", seq: 2 }, context)).not.toThrow();

    expect(errors).toHaveLength(1);
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.dropped": 1,
      "transport.dropped.queue-full": 1,
    });
  });

  it("splits flushes by estimated byte budget", async () => {
    const batches: string[][] = [];
    const transport = batchTransport(
      {
        name: "inner",
        logBatch(events) {
          batches.push(events.map((item) => item.id));
        },
      },
      {
        maxBatchSize: 10,
        maxBytes: 5,
        flushIntervalMs: 0,
        estimateEventBytes(item) {
          return item.seq === 3 ? 2 : 3;
        },
      },
    );

    const context = createContext();
    transport.log?.(event, context);
    transport.log?.({ ...event, id: "evt-2", seq: 2 }, context);
    transport.log?.({ ...event, id: "evt-3", seq: 3 }, context);
    await transport.flush?.();

    expect(batches).toEqual([["evt-1"], ["evt-2", "evt-3"]]);
  });

  it("drops records larger than the byte budget", async () => {
    resetLoggerMetaStats();
    const dropped: LogEvent[] = [];
    const logBatch = vi.fn<NonNullable<Transport["logBatch"]>>();
    const transport = batchTransport(
      {
        name: "inner",
        logBatch,
      },
      {
        maxBytes: 4,
        flushIntervalMs: 0,
        estimateEventBytes() {
          return 5;
        },
        onDrop(droppedEvent) {
          dropped.push(droppedEvent);
        },
      },
    );

    transport.log?.(event, createContext());
    await transport.flush?.();

    expect(dropped.map((item) => item.id)).toEqual(["evt-1"]);
    expect(logBatch).not.toHaveBeenCalled();
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.dropped": 1,
      "transport.dropped.record-too-large": 1,
    });
  });

  it("limits concurrent batch delivery", async () => {
    const batches: string[][] = [];
    let active = 0;
    let maxActive = 0;
    const transport = batchTransport(
      {
        name: "inner",
        async logBatch(events) {
          active += 1;
          maxActive = Math.max(maxActive, active);
          batches.push(events.map((item) => item.id));
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          active -= 1;
        },
      },
      {
        maxBatchSize: 10,
        maxBytes: 1,
        concurrency: 2,
        flushIntervalMs: 0,
        estimateEventBytes() {
          return 1;
        },
      },
    );

    const context = createContext();
    transport.log?.(event, context);
    transport.log?.({ ...event, id: "evt-2", seq: 2 }, context);
    transport.log?.({ ...event, id: "evt-3", seq: 3 }, context);
    transport.log?.({ ...event, id: "evt-4", seq: 4 }, context);
    await transport.flush?.();

    expect(maxActive).toBe(2);
    expect(batches).toEqual([["evt-1"], ["evt-2"], ["evt-3"], ["evt-4"]]);
  });

  it("retries transient delivery failures", async () => {
    resetLoggerMetaStats();
    const logBatch = vi.fn<NonNullable<Transport["logBatch"]>>(async () => {
      if (logBatch.mock.calls.length === 1) throw new Error("temporary failure");
    });
    const transport = batchTransport(
      {
        name: "inner",
        logBatch,
      },
      {
        maxBatchSize: 10,
        flushIntervalMs: 0,
        maxRetries: 1,
        retryBaseDelayMs: 0,
      },
    );

    transport.log?.(event, createContext());
    await transport.flush?.();

    expect(logBatch).toHaveBeenCalledTimes(2);
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.retry": 1,
    });
  });

  it("opens the circuit after retry exhaustion and keeps queued records", async () => {
    resetLoggerMetaStats();
    const logBatch = vi.fn<NonNullable<Transport["logBatch"]>>(async () => {
      throw new Error("delivery down");
    });
    const transport = batchTransport(
      {
        name: "inner",
        logBatch,
      },
      {
        maxBatchSize: 10,
        flushIntervalMs: 0,
        maxRetries: 1,
        retryBaseDelayMs: 0,
        circuitBreakerFailureThreshold: 1,
        circuitBreakerResetMs: 10_000,
      },
    );

    transport.log?.(event, createContext());
    await expect(transport.flush?.()).rejects.toThrow("delivery down");
    await transport.flush?.();

    expect(logBatch).toHaveBeenCalledTimes(2);
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.retry": 1,
      "transport.retry.exhausted": 1,
      "transport.circuit.open": 1,
    });
  });
});
