import { describe, expect, it } from "vitest";
import type { LogEvent } from "@loggerjs/core";
import { openTelemetryTraceProcessor, type OpenTelemetryApiLike } from "../src";

const event: LogEvent = {
  id: "evt-1",
  time: 1,
  seq: 1,
  level: 30,
  levelName: "info",
  logger: "api",
  message: "created",
};

describe("openTelemetryTraceProcessor", () => {
  it("adds trace context from the active span", () => {
    const api: OpenTelemetryApiLike = {
      trace: {
        getActiveSpan() {
          return {
            spanContext() {
              return {
                traceId: "0af7651916cd43dd8448eb211c80319c",
                spanId: "b7ad6b7169203331",
                traceFlags: 1,
              };
            },
          };
        },
      },
    };
    const processor = openTelemetryTraceProcessor({ api });

    expect(
      processor(event, { loggerName: "test", now: () => 1, reportInternalError() {} }),
    ).toEqual({
      ...event,
      trace: {
        traceId: "0af7651916cd43dd8448eb211c80319c",
        spanId: "b7ad6b7169203331",
        traceFlags: "01",
        sampled: true,
      },
    });
  });

  it("no-ops without an active span", () => {
    const processor = openTelemetryTraceProcessor({
      api: {
        trace: {
          getActiveSpan: () => undefined,
        },
      },
    });

    expect(processor(event, { loggerName: "test", now: () => 1, reportInternalError() {} })).toBe(
      event,
    );
  });
});
