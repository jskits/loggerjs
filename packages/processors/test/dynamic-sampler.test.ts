import { describe, expect, it, vi } from "vitest";
import type { LogEvent, ProcessorContext } from "@loggerjs/core";
import { dynamicSamplerProcessor } from "../src/dynamic-sampler";

function event(patch: Partial<LogEvent> = {}): LogEvent {
  return {
    id: "evt-1",
    time: 1,
    seq: 1,
    level: 30,
    levelName: "info",
    logger: "app",
    message: "created",
    type: "event",
    ...patch,
  };
}

const context: ProcessorContext = {
  loggerName: "app",
  now: () => 10,
  reportInternalError() {},
};

describe("dynamicSamplerProcessor", () => {
  it("samples with a default rate and records stats", () => {
    const onDrop = vi.fn<(item: LogEvent, key: string, rate: number) => void>();
    const processor = dynamicSamplerProcessor({
      defaultRate: 0.5,
      random: () => 0.75,
      onDrop,
    });

    expect(processor(event(), context)).toBe(false);
    expect(onDrop).toHaveBeenCalledWith(
      expect.objectContaining({ id: "evt-1" }),
      "app:info:event",
      0.5,
    );
    expect(processor.stats()).toEqual([
      {
        key: "app:info:event",
        seen: 1,
        kept: 0,
        dropped: 1,
        lastSeenMs: 10,
      },
    ]);
  });

  it("keeps error and fatal events by default", () => {
    const processor = dynamicSamplerProcessor({ defaultRate: 0 });

    expect(processor(event({ level: 50, levelName: "error" }), context)).toMatchObject({
      levelName: "error",
    });
  });

  it("supports dynamic rule rates and custom keys", () => {
    const processor = dynamicSamplerProcessor({
      rules: [
        {
          when: (item) => item.type === "debug.event",
          key: (item) => item.type ?? "unknown",
          rate: (_item, state) => (state.seen <= 1 ? 1 : 0),
        },
      ],
      random: () => 0.5,
    });

    const first = event({ type: "debug.event" });
    const second = event({ id: "evt-2", type: "debug.event" });

    expect(processor(first, context)).toBe(first);
    expect(processor(second, context)).toBe(false);
    expect(processor.stats()).toMatchObject([{ key: "debug.event", seen: 2, kept: 1, dropped: 1 }]);
  });

  it("uses sticky sampling keys and can reset stats", () => {
    const processor = dynamicSamplerProcessor({
      defaultRate: 0.5,
      key: () => "sticky",
      stickyBy: (item) => String(item.context?.userId),
    });
    const item = event({ context: { userId: "user-1" } });
    const first = processor(item, context);
    const second = processor(item, context);

    expect(second).toBe(first === false ? false : item);
    expect(processor.stats()[0]?.seen).toBe(2);
    processor.reset("sticky");
    expect(processor.stats()).toEqual([]);
  });
});
