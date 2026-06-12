import { describe, expect, it } from "vitest";
import { createRecord, recordToEvent, type LogEvent, type ProcessorContext } from "@loggerjs/core";
import {
  breadcrumbBuffer,
  coalesce,
  context,
  contextMw,
  dedupe,
  dynamicSampler,
  enrich,
  enrichMw,
  filter,
  fingerprint,
  levelOverride,
  logType,
  logTypeMw,
  normalizeError,
  privacyGuard,
  route,
  sample,
  schemaDevCheck,
  stackParser,
  symbolicateStack,
  tags,
  tagsMw,
  traceContext,
  traceContextMw,
} from "../src";

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
    expect(coalesce()(event, processorContext)).toBe(event);
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
    expect(levelOverride("warn")(event, processorContext)).toMatchObject({
      levelName: "warn",
    });
    expect(filter(() => true)(event, processorContext)).toBe(event);
    expect(route({ transports: ["remote"] })(event, processorContext)).toMatchObject({
      message: "created",
    });
    expect(fingerprint()(event, processorContext)).toMatchObject({
      tags: { fingerprint: expect.any(String) },
    });
    expect(normalizeError()(event, processorContext)).toBe(event);
    expect(stackParser()(event, processorContext)).toBe(event);
    expect(symbolicateStack({ symbolicate: () => undefined })(event, processorContext)).toBe(event);
    expect(privacyGuard()(event, processorContext)).toBe(event);
    expect(schemaDevCheck()(event, processorContext)).toBe(event);
    expect(dynamicSampler({ defaultRate: 1 })(event, processorContext)).toBe(event);
    expect(breadcrumbBuffer()(event, processorContext)).toBe(event);
  });

  it("exports record middleware aliases without replacing processor aliases", () => {
    const record = createRecord({
      time: 1,
      level: 30,
      category: "test",
      msg: "created",
      props: { orderId: "ord-1" },
      seq: 1,
    });

    tagsMw({ service: "api" }).process(record, {
      now: () => 1,
      reportInternalError() {},
    });
    logTypeMw("audit").process(record, {
      now: () => 1,
      reportInternalError() {},
    });
    contextMw({ requestId: "req-1" }).process(record, {
      now: () => 1,
      reportInternalError() {},
    });
    traceContextMw(() => ({ traceId: "trace-1" })).process(record, {
      now: () => 1,
      reportInternalError() {},
    });
    enrichMw({ data: { amount: 42 } }).process(record, {
      now: () => 1,
      reportInternalError() {},
    });

    expect(recordToEvent(record)).toMatchObject({
      type: "audit",
      tags: { service: "api" },
      data: { orderId: "ord-1", amount: 42 },
      context: { requestId: "req-1" },
      trace: { traceId: "trace-1" },
    });
  });
});
