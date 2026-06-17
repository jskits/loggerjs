import { describe, expect, it, vi } from "vitest";
import {
  cloneRecord,
  createBoundContext,
  createEncodeContext,
  createRecord,
  eventToRecord,
  isLogRecord,
  normalizeCategory,
  recordToEvent,
  resolveMessage,
  type LogEvent,
} from "../src";

const recordKeys = [
  "time",
  "level",
  "category",
  "type",
  "tags",
  "trace",
  "msg",
  "lazy",
  "props",
  "err",
  "ctx",
  "source",
  "stack",
  "seq",
];

function lazyRecordMessage() {
  return "created";
}

describe("LogRecord helpers", () => {
  it("creates records with the target field order and defaults", () => {
    const record = createRecord({
      time: 10,
      level: 30,
      seq: 2,
    });

    expect(Object.keys(record)).toEqual(recordKeys);
    expect(record).toMatchObject({
      time: 10,
      level: 30,
      category: ["app"],
      type: null,
      tags: null,
      trace: null,
      msg: null,
      lazy: null,
      props: null,
      err: null,
      ctx: null,
      source: "app",
      stack: null,
      seq: 2,
    });
    expect(Object.isFrozen(record.category)).toBe(true);
  });

  it("normalizes categories and bound context for immutable reuse", () => {
    const category = normalizeCategory(["api", "checkout"]);
    const stringCategory = normalizeCategory("worker");
    const emptyCategory = normalizeCategory([]);
    const context = createBoundContext({ requestId: "req-1" });

    expect(category).toEqual(["api", "checkout"]);
    expect(Object.isFrozen(category)).toBe(true);
    expect(stringCategory).toEqual(["worker"]);
    expect(Object.isFrozen(stringCategory)).toBe(true);
    expect(emptyCategory).toEqual(["app"]);
    expect(context).toEqual({ requestId: "req-1" });
    expect(Object.isFrozen(context)).toBe(true);
    expect(createBoundContext({})).toBeNull();
    expect(createBoundContext(null)).toBeNull();
    expect(createBoundContext(undefined)).toBeNull();
  });

  it("clones records with the same field order and patched values", () => {
    const record = createRecord({
      time: 10,
      level: 30,
      category: ["api"],
      msg: "created",
      props: { orderId: "ord-1" },
      seq: 2,
    });
    const clone = cloneRecord(record, {
      time: 11,
      level: 40,
      source: "integration:fetch",
      seq: 3,
    });

    expect(Object.keys(clone)).toEqual(recordKeys);
    expect(clone).not.toBe(record);
    expect(clone).toMatchObject({
      time: 11,
      level: 40,
      category: ["api"],
      msg: "created",
      props: { orderId: "ord-1" },
      source: "integration:fetch",
      seq: 3,
    });
    expect(cloneRecord(record, { time: undefined, seq: undefined })).toMatchObject({
      time: 10,
      seq: 2,
    });
    expect(record.level).toBe(30);
    expect(record.source).toBe("app");
  });

  it("clones records with explicit nullable field clears", () => {
    const error = new Error("failed");
    const context = createBoundContext({ requestId: "req-1" });
    const record = createRecord({
      time: 10,
      level: 30,
      category: ["api"],
      type: "order.created",
      tags: { service: "checkout" },
      trace: { traceId: "trace-1" },
      msg: "created",
      lazy: lazyRecordMessage,
      props: { orderId: "ord-1" },
      err: error,
      ctx: context,
      source: "integration:fetch",
      stack: "stack",
      seq: 2,
    });
    const clone = cloneRecord(record, {
      type: null,
      tags: null,
      trace: null,
      msg: null,
      lazy: null,
      props: null,
      err: null,
      ctx: null,
      stack: null,
    });

    expect(Object.keys(clone)).toEqual(recordKeys);
    expect(clone).toMatchObject({
      type: null,
      tags: null,
      trace: null,
      msg: null,
      lazy: null,
      props: null,
      err: null,
      ctx: null,
      source: "integration:fetch",
      stack: null,
    });
  });

  it("resolves lazy messages at most once", () => {
    const lazy = vi.fn<() => string>(() => "expensive message");
    const record = createRecord({
      time: 10,
      level: 20,
      lazy,
      seq: 2,
    });

    expect(resolveMessage(record)).toBe("expensive message");
    expect(resolveMessage(record)).toBe("expensive message");
    expect(lazy).toHaveBeenCalledTimes(1);
    expect(record.lazy).toBeNull();
  });

  it("resolves missing messages to an empty string without creating errors", () => {
    const record = createRecord({
      time: 10,
      level: 20,
      seq: 2,
    });

    expect(resolveMessage(record)).toBe("");
    expect(recordToEvent(record)).toMatchObject({
      message: "",
      error: undefined,
    });
  });

  it("turns lazy message resolver failures into stable record state", () => {
    const failure = new Error("message failed");
    const lazy = vi.fn<() => string>(() => {
      throw failure;
    });
    const record = createRecord({
      time: 10,
      level: 20,
      lazy,
      seq: 2,
    });

    expect(resolveMessage(record)).toBe("[loggerjs message resolver failed]");
    expect(resolveMessage(record)).toBe("[loggerjs message resolver failed]");
    expect(lazy).toHaveBeenCalledTimes(1);
    expect(record.err).toBe(failure);
    expect(record.lazy).toBeNull();

    const existingError = new Error("transport failed");
    const existingErrorRecord = createRecord({
      time: 11,
      level: 20,
      lazy: () => {
        throw failure;
      },
      err: existingError,
      seq: 3,
    });

    expect(resolveMessage(existingErrorRecord)).toBe("[loggerjs message resolver failed]");
    expect(existingErrorRecord.err).toBe(existingError);
  });

  it("projects records to the compatibility LogEvent shape", () => {
    const error = new Error("save failed");
    const record = createRecord({
      time: 10,
      level: 50,
      category: ["api", "orders"],
      type: "order.save_failed",
      tags: { service: "checkout" },
      trace: { traceId: "trace-1" },
      msg: "save failed",
      props: { orderId: "ord-1" },
      err: error,
      ctx: createBoundContext({ requestId: "req-1" }),
      source: "integration:fetch",
      seq: 2,
    });

    expect(recordToEvent(record)).toMatchObject({
      id: "a-2-error",
      time: 10,
      seq: 2,
      level: 50,
      levelName: "error",
      logger: "api.orders",
      message: "save failed",
      type: "order.save_failed",
      tags: { service: "checkout" },
      data: { orderId: "ord-1" },
      error: {
        name: "Error",
        message: "save failed",
      },
      context: { requestId: "req-1" },
      trace: { traceId: "trace-1" },
      source: { integration: "integration:fetch" },
    });
  });

  it("applies explicit projection overrides when converting records to events", () => {
    const record = createRecord({
      time: 10,
      level: 30,
      category: ["api"],
      type: "order.created",
      tags: { service: "checkout" },
      trace: { traceId: "record-trace" },
      msg: "created",
      props: { orderId: "ord-1" },
      err: new Error("record error"),
      seq: 2,
    });
    const event = recordToEvent(record, {
      id: (candidate, levelName) => `${candidate.seq}-${levelName}`,
      levelName: "warn",
      logger: "override",
      type: "order.override",
      tags: { service: "billing" },
      data: { invoiceId: "inv-1" },
      error: { name: "OverrideError", message: "override" },
      trace: { traceId: "override-trace" },
      source: { runtime: "edge" },
    });

    expect(event).toMatchObject({
      id: "2-warn",
      levelName: "warn",
      logger: "override",
      type: "order.override",
      tags: { service: "billing" },
      data: { invoiceId: "inv-1" },
      error: { name: "OverrideError", message: "override" },
      trace: { traceId: "override-trace" },
      source: { runtime: "edge" },
    });
  });

  it("keeps record props and event data shared by reference", () => {
    const props = { orderId: "ord-1" };
    const record = createRecord({
      time: 10,
      level: 30,
      msg: "created",
      props,
      seq: 2,
    });
    const event = recordToEvent(record);

    expect(event.data).toBe(props);
    props.orderId = "ord-2";
    expect(event.data).toEqual({ orderId: "ord-2" });

    const roundTripped = eventToRecord({
      id: "evt-1",
      time: 10,
      seq: 2,
      level: 30,
      levelName: "info",
      logger: "api",
      message: "created",
      data: props,
    });

    expect(roundTripped.props).toBe(props);
  });

  it("round trips app events without fabricating a source", () => {
    const event: LogEvent = {
      id: "evt-1",
      time: 10,
      seq: 2,
      level: 30,
      levelName: "info",
      logger: "api.orders",
      message: "created",
      tags: { service: "checkout" },
      data: { orderId: "ord-1" },
    };

    const record = eventToRecord(event);
    expect(record.source).toBe("app");

    const roundTripped = recordToEvent(record);
    expect(roundTripped.source).toBeUndefined();
    expect(roundTripped).toMatchObject({
      logger: "api.orders",
      message: "created",
      tags: { service: "checkout" },
      data: { orderId: "ord-1" },
    });
  });

  it("documents the lossy parts of the event to record conversion", () => {
    const event: LogEvent = {
      id: "evt-1",
      time: 10,
      seq: 2,
      level: 30,
      levelName: "info",
      logger: "api",
      message: "created",
      data: "scalar payload",
      source: { runtime: "node" },
    };

    const record = eventToRecord(event);
    // Scalar data must be wrapped because record props are always an object.
    expect(record.props).toEqual({ value: "scalar payload" });
    // A runtime source collapses to a string and projects back as integration.
    expect(record.source).toBe("node");
    expect(recordToEvent(record).source).toEqual({ integration: "node" });
  });

  it("normalizes sparse event fields when converting events to records", () => {
    const undefinedData = eventToRecord({
      id: "evt-1",
      time: 10,
      seq: 2,
      level: 30,
      levelName: "info",
      logger: "..",
      message: "created",
      data: undefined,
    });
    const arrayData = eventToRecord({
      id: "evt-2",
      time: 11,
      seq: 3,
      level: 30,
      levelName: "info",
      logger: "api..orders",
      message: "items",
      data: ["a", "b"],
    });

    expect(undefinedData.category).toEqual(["app"]);
    expect(undefinedData.props).toBeNull();
    expect(arrayData.category).toEqual(["api", "orders"]);
    expect(arrayData.props).toEqual({ value: ["a", "b"] });
  });

  it("preserves optional event fields when converting events to records", () => {
    const error = { name: "TypeError", message: "bad input" };
    const trace = { traceId: "trace-1" };
    const record = eventToRecord({
      id: "evt-1",
      time: 10,
      seq: 2,
      level: 40,
      levelName: "warn",
      logger: "api.orders",
      message: "invalid",
      type: "order.invalid",
      trace,
      error,
    });

    expect(record).toMatchObject({
      type: "order.invalid",
      trace,
      err: error,
    });
  });

  it("recognizes records without treating partial event-like objects as records", () => {
    const record = createRecord({ time: 10, level: 30, msg: "created", seq: 2 });

    expect(isLogRecord(record)).toBe(true);
    expect(isLogRecord(null)).toBe(false);
    expect(isLogRecord({ category: ["api"] })).toBe(false);
    expect(
      isLogRecord({
        id: "evt-1",
        time: 10,
        seq: 2,
        level: 30,
        levelName: "info",
        logger: "api",
        message: "created",
      }),
    ).toBe(false);
  });

  it("memoizes the default id time segment without staleness", () => {
    const first = createRecord({ time: 1700000000000, level: 30, msg: "a", seq: 1 });
    const second = createRecord({ time: 1700000000000, level: 30, msg: "b", seq: 2 });
    const later = createRecord({ time: 1700000000001, level: 30, msg: "c", seq: 3 });

    expect(recordToEvent(first).id).toBe(`${(1700000000000).toString(36)}-1-info`);
    expect(recordToEvent(second).id).toBe(`${(1700000000000).toString(36)}-2-info`);
    expect(recordToEvent(later).id).toBe(`${(1700000000001).toString(36)}-3-info`);
    // Going back to an earlier time must not reuse the newer cached segment.
    expect(recordToEvent(first).id).toBe(`${(1700000000000).toString(36)}-1-info`);
  });

  it("creates independent encode caches", () => {
    const first = createEncodeContext();
    const second = createEncodeContext();

    expect(first.levelName(30)).toBe("info");
    expect(first.ctxCache).not.toBe(second.ctxCache);
    expect(first.schemaCache).not.toBe(second.schemaCache);
  });
});
