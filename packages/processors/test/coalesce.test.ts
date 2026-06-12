import { describe, expect, it } from "vitest";
import {
  getLoggerMetaStats,
  resetLoggerMetaStats,
  type LogEvent,
  type ProcessorContext,
} from "@loggerjs/core";
import { coalesceProcessor } from "../src/coalesce";

const event: LogEvent = {
  id: "evt-1",
  time: 1,
  seq: 1,
  level: 40,
  levelName: "error",
  logger: "test",
  message: "database unavailable",
};

function context(now: number): ProcessorContext {
  return {
    loggerName: "test",
    now: () => now,
    reportInternalError() {},
  };
}

describe("coalesceProcessor", () => {
  it("suppresses repeated events and emits the coalesced count on the next window", () => {
    resetLoggerMetaStats();
    const processor = coalesceProcessor({ windowMs: 100 });

    expect(processor(event, context(0))).toBe(event);
    expect(processor({ ...event, id: "evt-2" }, context(10))).toBe(false);
    expect(processor({ ...event, id: "evt-3" }, context(20))).toBe(false);

    const next = processor({ ...event, id: "evt-4" }, context(200)) as LogEvent;

    expect(next.message).toBe("database unavailable (x3)");
    expect(next.data).toEqual({
      value: undefined,
      coalesced: {
        count: 3,
        firstSeen: 0,
        key: "error:database unavailable:",
        lastSeen: 20,
      },
    });
    expect(getLoggerMetaStats()).toMatchObject({
      "processor.coalesce.suppressed": 2,
    });
  });
});
