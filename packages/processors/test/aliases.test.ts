import { describe, expect, it } from "vitest";
import type { LogEvent, ProcessorContext } from "@loggerjs/core";
import { context, dedupe, enrich, logType, sample, tags, traceContext } from "../src";

const event: LogEvent = {
  id: "evt-1",
  time: 1,
  seq: 1,
  level: 30,
  levelName: "info",
  logger: "test",
  message: "created",
};

const processorContext: ProcessorContext = {
  loggerName: "test",
  now: () => 1,
  reportInternalError() {},
};

describe("processor middleware aliases", () => {
  it("exports shorter middleware-style names", () => {
    expect(sample({ defaultRate: 1 })(event, processorContext)).toBe(event);
    expect(dedupe()(event, processorContext)).toBe(event);
    expect(tags({ service: "api" })(event, processorContext)).toMatchObject({
      tags: { service: "api" },
    });
    expect(logType("audit")(event, processorContext)).toMatchObject({
      type: "audit",
    });
    expect(context({ requestId: "req-1" })(event, processorContext)).toMatchObject({
      context: { requestId: "req-1" },
    });
    expect(traceContext(() => ({ traceId: "trace-1" }))(event, processorContext)).toMatchObject({
      trace: { traceId: "trace-1" },
    });
    expect(enrich({ data: { feature: "checkout" } })(event, processorContext)).toMatchObject({
      data: { feature: "checkout" },
    });
  });
});
