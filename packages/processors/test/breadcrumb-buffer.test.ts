import { describe, expect, it } from "vitest";
import type { LogEvent, ProcessorContext } from "@loggerjs/core";
import { breadcrumbBufferProcessor } from "../src/breadcrumb-buffer";

const context: ProcessorContext = {
  loggerName: "app",
  now: () => 1,
  reportInternalError() {},
};

function event(patch: Partial<LogEvent> = {}): LogEvent {
  return {
    id: patch.id ?? "evt-1",
    time: patch.time ?? 1,
    seq: patch.seq ?? 1,
    level: patch.level ?? 30,
    levelName: patch.levelName ?? "info",
    logger: "app",
    message: "created",
    ...patch,
  };
}

describe("breadcrumbBufferProcessor", () => {
  it("attaches buffered breadcrumbs to error events by key", () => {
    const processor = breadcrumbBufferProcessor({
      key: (item) => String(item.context?.sessionId),
    });

    const first = event({ id: "evt-1", time: 1, message: "clicked", context: { sessionId: "s1" } });
    const second = event({
      id: "evt-2",
      time: 2,
      message: "submitted",
      context: { sessionId: "s1" },
    });
    const failure = event({
      id: "evt-3",
      time: 3,
      level: 50,
      levelName: "error",
      message: "failed",
      context: { sessionId: "s1" },
    });

    expect(processor(first, context)).toBe(first);
    expect(processor(second, context)).toBe(second);
    expect(processor(failure, context)).toMatchObject({
      context: {
        sessionId: "s1",
        breadcrumbs: [
          { time: 1, levelName: "info", logger: "app", message: "clicked" },
          { time: 2, levelName: "info", logger: "app", message: "submitted" },
        ],
      },
    });
  });

  it("supports custom mapping, data target, trigger inclusion, and buffer size", () => {
    const processor = breadcrumbBufferProcessor({
      bufferSize: 1,
      includeTrigger: true,
      target: "data",
      field: "crumbs",
      map: (item) => item.message,
    });

    processor(event({ message: "first" }), context);
    processor(event({ message: "second" }), context);
    const processed = processor(
      event({ level: 50, levelName: "error", message: "boom", data: { orderId: "ord-1" } }),
      context,
    );

    expect(processed).toMatchObject({
      data: {
        orderId: "ord-1",
        crumbs: ["second", "boom"],
      },
    });
  });

  it("can clear on trigger and reset states", () => {
    const processor = breadcrumbBufferProcessor({ clearOnTrigger: true });

    processor(event({ message: "before" }), context);
    expect(processor.states()).toMatchObject([{ key: "app", buffered: 1 }]);
    processor(event({ level: 50, levelName: "error" }), context);
    expect(processor.states()).toMatchObject([{ key: "app", buffered: 0 }]);
    processor.reset("app");
    expect(processor.states()).toEqual([]);
  });
});
