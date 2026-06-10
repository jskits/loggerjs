import { describe, expect, it } from "vitest";
import type { LogEvent, ProcessorContext } from "@loggerjs/core";
import { fingerprintProcessor } from "../src/fingerprint";

const event: LogEvent = {
  id: "evt-1",
  time: 1,
  seq: 1,
  level: 50,
  levelName: "error",
  logger: "app.http",
  message: "request failed",
  type: "http.request",
  tags: { route: "/checkout" },
  error: {
    name: "TypeError",
    message: "Cannot read properties",
    stack: "TypeError: Cannot read properties\n    at loadCheckout (checkout.ts:10:5)",
  },
  source: { integration: "integration:fetch", runtime: "browser" },
};

const context: ProcessorContext = {
  loggerName: "app",
  now: () => 1,
  reportInternalError() {},
};

describe("fingerprintProcessor", () => {
  it("adds a deterministic default fingerprint tag", () => {
    const processor = fingerprintProcessor();
    const first = processor(event, context) as LogEvent;
    const second = processor({ ...event, id: "evt-2", seq: 2 }, context) as LogEvent;

    expect(first.tags?.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(first.tags?.fingerprint).toBe(second.tags?.fingerprint);
  });

  it("changes fingerprint when selected parts change", () => {
    const processor = fingerprintProcessor({ parts: ["logger", "message"] });
    const first = processor(event, context) as LogEvent;
    const second = processor({ ...event, message: "other failure" }, context) as LogEvent;

    expect(first.tags?.fingerprint).not.toBe(second.tags?.fingerprint);
  });

  it("supports custom parts, hash, prefix, and context target", () => {
    const processor = fingerprintProcessor({
      parts: ["stack.top", (item, ctx) => `${ctx.loggerName}:${item.levelName}`],
      hash: (input) => input,
      key: "group",
      prefix: "fp:",
      target: "context",
    });

    expect(processor(event, context)).toMatchObject({
      context: {
        group: "fp:at loadCheckout (checkout.ts:10:5)\u001fapp:error",
      },
    });
  });
});
