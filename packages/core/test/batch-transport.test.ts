import { describe, expect, it } from "vitest";
import {
  batchTransport,
  getLoggerMetaStats,
  resetLoggerMetaStats,
  type LogEvent,
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
});
