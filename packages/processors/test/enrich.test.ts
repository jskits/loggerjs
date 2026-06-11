import { describe, expect, it } from "vitest";
import { createRecord, recordToEvent, type LogEvent, type ProcessorContext } from "@loggerjs/core";
import { enrichMiddleware, enrichProcessor } from "../src/enrich";

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

describe("enrichMiddleware", () => {
  it("merges static enrichment into LogRecord fields before event projection", () => {
    const record = createRecord({
      time: 1,
      level: 30,
      category: "app",
      msg: "created",
      props: { orderId: "ord-1" },
      seq: 1,
    });
    const middleware = enrichMiddleware({
      tags: { service: "checkout" },
      data: { amount: 42 },
      context: { tenant: "acme" },
      trace: { traceId: "trace-1" },
      source: { integration: "test" },
      type: "order.created",
    });

    expect(
      middleware.process(record, {
        now: () => 1,
        reportInternalError() {},
      }),
    ).toBe(record);

    expect(recordToEvent(record)).toMatchObject({
      type: "order.created",
      tags: { service: "checkout" },
      data: { orderId: "ord-1", amount: 42 },
      context: { tenant: "acme" },
      trace: { traceId: "trace-1" },
      source: { integration: "test" },
    });
  });

  it("supports callback enrichment and dropping records", () => {
    const record = createRecord({
      time: 1,
      level: 30,
      category: "app",
      msg: "created",
      seq: 1,
    });
    const middleware = enrichMiddleware((item, ctx) => ({
      message: `${item.msg} at ${ctx.now()}`,
      tags: { source: "middleware" },
    }));

    middleware.process(record, {
      now: () => 10,
      reportInternalError() {},
    });

    expect(recordToEvent(record)).toMatchObject({
      message: "created at 10",
      tags: { source: "middleware" },
    });
    expect(
      enrichMiddleware(() => false).process(record, {
        now: () => 10,
        reportInternalError() {},
      }),
    ).toBeNull();
  });
});
