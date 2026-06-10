import { describe, expect, it } from "vitest";
import {
  type LogEvent,
  type ProcessorContext,
  resetLoggerMetaStats,
  getLoggerMetaStats,
} from "@loggerjs/core";
import { rateLimitProcessor } from "../src/rate-limit";

function event(patch: Partial<LogEvent> = {}): LogEvent {
  return {
    id: "1",
    time: 1,
    seq: 1,
    level: 30,
    levelName: "info",
    logger: "app",
    message: "hello",
    ...patch,
  };
}

function context(now: () => number): ProcessorContext {
  return {
    loggerName: "app",
    now,
    reportInternalError() {},
  };
}

describe("rateLimitProcessor", () => {
  it("drops events after bucket capacity is exhausted", () => {
    resetLoggerMetaStats();
    let now = 0;
    const dropped: string[] = [];
    const processor = rateLimitProcessor({
      capacity: 2,
      refillPerSecond: 0.1,
      onDrop: (droppedEvent, key) => dropped.push(`${droppedEvent.id}:${key}`),
    });
    const ctx = context(() => now);

    expect(processor(event({ id: "1" }), ctx)).toBeTruthy();
    expect(processor(event({ id: "2" }), ctx)).toBeTruthy();
    expect(processor(event({ id: "3" }), ctx)).toBe(false);
    now = 10_000;
    expect(processor(event({ id: "4" }), ctx)).toBeTruthy();

    expect(dropped).toEqual(["3:app:info:manual"]);
    expect(getLoggerMetaStats()["processor.rateLimit.dropped"]).toBe(1);
    expect(getLoggerMetaStats()["processor.rateLimit.dropped.info"]).toBe(1);
  });

  it("uses independent buckets and exempts errors by default", () => {
    const processor = rateLimitProcessor({ capacity: 1, refillPerSecond: 0 });
    const ctx = context(() => 0);

    expect(processor(event({ id: "1", logger: "a" }), ctx)).toBeTruthy();
    expect(processor(event({ id: "2", logger: "a" }), ctx)).toBe(false);
    expect(processor(event({ id: "3", logger: "b" }), ctx)).toBeTruthy();
    expect(processor(event({ id: "4", level: 50, levelName: "error" }), ctx)).toBeTruthy();
  });

  it("supports custom keys", () => {
    const processor = rateLimitProcessor({
      capacity: 1,
      refillPerSecond: 0,
      key: (item) => (item.tags?.tenant === "a" ? "tenant-a" : "other"),
    });
    const ctx = context(() => 0);

    expect(processor(event({ id: "1", tags: { tenant: "a" } }), ctx)).toBeTruthy();
    expect(processor(event({ id: "2", tags: { tenant: "a" } }), ctx)).toBe(false);
    expect(processor(event({ id: "3", tags: { tenant: "b" } }), ctx)).toBeTruthy();
  });
});
