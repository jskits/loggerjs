import { describe, expect, it, vi } from "vitest";
import {
  cloneRecord,
  createBoundContext,
  createEncodeContext,
  createRecord,
  eventToRecord,
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
    const context = createBoundContext({ requestId: "req-1" });

    expect(category).toEqual(["api", "checkout"]);
    expect(Object.isFrozen(category)).toBe(true);
    expect(context).toEqual({ requestId: "req-1" });
    expect(Object.isFrozen(context)).toBe(true);
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
      level: 40,
      source: "integration:fetch",
    });

    expect(Object.keys(clone)).toEqual(recordKeys);
    expect(clone).not.toBe(record);
    expect(clone).toMatchObject({
      level: 40,
      category: ["api"],
      msg: "created",
      props: { orderId: "ord-1" },
      source: "integration:fetch",
    });
    expect(record.level).toBe(30);
    expect(record.source).toBe("app");
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

  it("creates independent encode caches", () => {
    const first = createEncodeContext();
    const second = createEncodeContext();

    expect(first.levelName(30)).toBe("info");
    expect(first.ctxCache).not.toBe(second.ctxCache);
    expect(first.schemaCache).not.toBe(second.schemaCache);
  });
});
