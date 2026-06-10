import { describe, expect, it } from "vitest";
import type { LogEvent, ProcessorContext } from "@loggerjs/core";
import { enrichProcessor } from "../src/enrich";

const event: LogEvent = {
  id: "evt-1",
  time: 1,
  seq: 1,
  level: 30,
  levelName: "info",
  logger: "app",
  message: "created",
  tags: { route: "/orders" },
  data: { orderId: "ord-1" },
  context: { requestId: "req-1" },
};

const context: ProcessorContext = {
  loggerName: "app",
  now: () => 10,
  reportInternalError() {},
};

describe("enrichProcessor", () => {
  it("merges static enrichment into structured fields", () => {
    const processor = enrichProcessor({
      tags: { service: "checkout" },
      data: { amount: 42 },
      context: { tenant: "acme" },
      trace: { traceId: "trace-1" },
      source: { integration: "test" },
      type: "order.created",
    });

    expect(processor(event, context)).toMatchObject({
      type: "order.created",
      tags: { route: "/orders", service: "checkout" },
      data: { orderId: "ord-1", amount: 42 },
      context: { requestId: "req-1", tenant: "acme" },
      trace: { traceId: "trace-1" },
      source: { integration: "test" },
    });
  });

  it("supports callback enrichment with processor context", () => {
    const processor = enrichProcessor((item, ctx) => ({
      message: `${item.message} at ${ctx.now()}`,
      tags: { logger: ctx.loggerName },
    }));

    expect(processor(event, context)).toMatchObject({
      message: "created at 10",
      tags: { route: "/orders", logger: "app" },
    });
  });

  it("can drop events from callback enrichment", () => {
    const processor = enrichProcessor(() => false);

    expect(processor(event, context)).toBe(false);
  });
});
