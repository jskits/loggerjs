import { describe, expect, it } from "vitest";
import type { LogEvent, ProcessorContext } from "@loggerjs/core";
import { sampleProcessor } from "../src";

const event: LogEvent = {
  id: "evt-1",
  time: 1,
  seq: 1,
  level: 20,
  levelName: "debug",
  logger: "test",
  message: "debug details",
};

const context: ProcessorContext = {
  loggerName: "test",
  now: () => 1,
  reportInternalError() {},
};

describe("sampleProcessor", () => {
  it("drops events when the configured rate is zero", () => {
    const processor = sampleProcessor({ defaultRate: 0 });

    expect(processor(event, context)).toBe(false);
  });

  it("keeps events when the configured rate is one", () => {
    const processor = sampleProcessor({ defaultRate: 1 });

    expect(processor(event, context)).toBe(event);
  });
});
