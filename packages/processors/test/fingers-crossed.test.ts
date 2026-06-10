import { afterEach, describe, expect, it } from "vitest";
import {
  createLogger,
  getLoggerMetaStats,
  memoryTransport,
  resetLoggerMetaStats,
  type LogEvent,
  type ProcessorContext,
} from "@loggerjs/core";
import { fingersCrossedProcessor } from "../src/fingers-crossed";

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

describe("fingersCrossedProcessor", () => {
  afterEach(() => {
    resetLoggerMetaStats();
  });

  it("buffers events until a trigger flushes them to a target", async () => {
    const flushed = memoryTransport();
    const normal = memoryTransport();
    const logger = createLogger({
      level: "debug",
      processors: [fingersCrossedProcessor({ bufferSize: 2, flushTo: flushed })],
      transports: [normal],
    });

    logger.debug("debug context");
    logger.info("info context");
    logger.error("save failed");
    await Promise.resolve();
    logger.warn("after trigger");

    expect(flushed.events.map((item) => item.message)).toEqual([
      "debug context",
      "info context",
      "save failed",
    ]);
    expect(normal.events.map((item) => item.message)).toEqual(["after trigger"]);
    expect(getLoggerMetaStats()["processor.fingersCrossed.triggered"]).toBe(1);
    expect(getLoggerMetaStats()["processor.fingersCrossed.flushed"]).toBe(3);
  });

  it("acts as a gate when no flush target is configured", () => {
    let now = 0;
    const processor = fingersCrossedProcessor({ activationMs: 50 });
    const ctx = context(() => now);

    expect(processor(event({ id: "1", level: 20, levelName: "debug" }), ctx)).toBe(false);
    expect(processor(event({ id: "2", level: 50, levelName: "error" }), ctx)).toBeTruthy();
    now = 25;
    expect(processor(event({ id: "3", level: 30, levelName: "info" }), ctx)).toBeTruthy();
    now = 60;
    expect(processor(event({ id: "4", level: 30, levelName: "info" }), ctx)).toBe(false);
  });

  it("keeps a bounded ring buffer and reports drops", async () => {
    const flushed = memoryTransport();
    const dropped: string[] = [];
    const processor = fingersCrossedProcessor({
      bufferSize: 1,
      flushTo: flushed,
      onDrop: (item, reason, key) => dropped.push(`${item.id}:${reason}:${key}`),
    });
    const ctx = context(() => 0);

    expect(processor(event({ id: "1", message: "first" }), ctx)).toBe(false);
    expect(processor(event({ id: "2", message: "second" }), ctx)).toBe(false);
    expect(processor(event({ id: "3", level: 50, levelName: "error", message: "boom" }), ctx)).toBe(
      false,
    );
    await Promise.resolve();

    expect(flushed.events.map((item) => item.message)).toEqual(["second", "boom"]);
    expect(dropped).toEqual(["1:buffer-full:default"]);
    expect(getLoggerMetaStats()["processor.fingersCrossed.dropped"]).toBe(1);
    expect(getLoggerMetaStats()["processor.fingersCrossed.dropped.buffer-full"]).toBe(1);
  });

  it("supports independent keyed buffers and explicit reset", () => {
    const processor = fingersCrossedProcessor({
      key: (item) => String(item.tags?.requestId ?? "none"),
    });
    const ctx = context(() => 0);

    expect(processor(event({ id: "1", tags: { requestId: "a" } }), ctx)).toBe(false);
    expect(processor(event({ id: "2", tags: { requestId: "b" } }), ctx)).toBe(false);
    expect(new Set(processor.states().map((state) => state.key))).toEqual(new Set(["a", "b"]));

    processor.reset("a");

    expect(processor.states().map((state) => state.key)).toEqual(["b"]);
  });
});
