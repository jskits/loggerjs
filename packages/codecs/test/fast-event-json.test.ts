import { describe, expect, it } from "vitest";
import { createRecord, recordToEvent, type LogEvent } from "@loggerjs/core";
import { fastEventJsonCodec, msgpackrCodec, projectorCodec } from "../src";

function sampleEvent(patch: Partial<LogEvent> = {}): LogEvent {
  return {
    id: "evt-1",
    time: 1,
    seq: 1,
    level: 30,
    levelName: "info",
    logger: "api",
    message: "created",
    ...patch,
  };
}

describe("fast event json hostile inputs", () => {
  it("falls back to safe encoding for circular data by default", () => {
    const data: Record<string, unknown> = { orderId: "ord-1" };
    data.self = data;
    const payload = fastEventJsonCodec().encode(sampleEvent({ data }));
    expect(JSON.parse(payload)).toMatchObject({
      message: "created",
      data: { orderId: "ord-1", self: "[Circular]" },
    });
  });

  it("falls back to safe encoding for BigInt data by default", () => {
    const payload = fastEventJsonCodec().encode(sampleEvent({ data: { big: 10n } }));
    expect(JSON.parse(payload)).toMatchObject({ data: { big: "10" } });
  });

  it("encodes a batch containing one poison item without losing the rest", () => {
    const data: Record<string, unknown> = {};
    data.self = data;
    const batch = [sampleEvent(), sampleEvent({ id: "evt-2", seq: 2, data })];
    const decoded = JSON.parse(fastEventJsonCodec().encode(batch)) as LogEvent[];
    expect(decoded).toHaveLength(2);
    expect(decoded[0]).toMatchObject({ id: "evt-1", message: "created" });
    expect(decoded[1]).toMatchObject({ id: "evt-2", data: { self: "[Circular]" } });
  });

  it("falls back to safe encoding for circular record props", () => {
    const props: Record<string, unknown> = { orderId: "ord-1" };
    props.self = props;
    const record = createRecord({ time: 1, level: 30, msg: "created", props, seq: 1 });
    expect(JSON.parse(fastEventJsonCodec().encode(record))).toMatchObject({
      message: "created",
      data: { orderId: "ord-1", self: "[Circular]" },
    });
  });

  it("serializes nested errors as empty objects on the default native path", () => {
    const payload = fastEventJsonCodec().encode(sampleEvent({ data: { err: new Error("boom") } }));
    expect(JSON.parse(payload)).toMatchObject({ data: { err: {} } });
  });

  it("preserves nested error fields when any safe option is set", () => {
    const codec = fastEventJsonCodec({ maxDepth: 8 });
    const payload = codec.encode(sampleEvent({ data: { err: new Error("boom") } }));
    expect(JSON.parse(payload)).toMatchObject({
      data: { err: { name: "Error", message: "boom" } },
    });
  });

  it("escapes messages and types that need JSON escaping", () => {
    const record = createRecord({
      time: 1,
      level: 30,
      type: 'order "quoted"',
      msg: 'line one\nline "two" \\ end',
      seq: 1,
    });
    const decoded = JSON.parse(fastEventJsonCodec().encode(record)) as LogEvent;
    expect(decoded.message).toBe('line one\nline "two" \\ end');
    expect(decoded.type).toBe('order "quoted"');
  });

  it("falls back safely when frozen tags contain BigInt values", () => {
    const record = createRecord({
      time: 1,
      level: 30,
      msg: "created",
      tags: Object.freeze({ big: 10n }) as unknown as Record<string, string>,
      seq: 1,
    });
    const decoded = JSON.parse(fastEventJsonCodec().encode(record)) as LogEvent;
    expect(decoded.tags).toEqual({ big: "10" });
  });

  it("caches frozen tags fragments per object identity", () => {
    const codec = fastEventJsonCodec();
    const sharedTags = Object.freeze({ service: "checkout" });
    const otherTags = Object.freeze({ service: "billing" });
    const first = createRecord({ time: 1, level: 30, msg: "a", tags: sharedTags, seq: 1 });
    const second = createRecord({ time: 1, level: 30, msg: "b", tags: sharedTags, seq: 2 });
    const third = createRecord({ time: 1, level: 30, msg: "c", tags: otherTags, seq: 3 });

    expect((JSON.parse(codec.encode(first)) as LogEvent).tags).toEqual({ service: "checkout" });
    expect((JSON.parse(codec.encode(second)) as LogEvent).tags).toEqual({ service: "checkout" });
    expect((JSON.parse(codec.encode(third)) as LogEvent).tags).toEqual({ service: "billing" });
  });

  it("omits id, seq, and levelName when lean output options are set", () => {
    const codec = fastEventJsonCodec({
      includeId: false,
      includeSeq: false,
      includeLevelName: false,
    });
    const record = createRecord({
      time: 1700000000000,
      level: 30,
      category: ["api"],
      msg: "created",
      props: { orderId: "ord-1" },
      seq: 7,
    });

    const decodedRecord = JSON.parse(codec.encode(record)) as Record<string, unknown>;
    expect(decodedRecord).toEqual({
      time: 1700000000000,
      level: 30,
      logger: "api",
      message: "created",
      data: { orderId: "ord-1" },
    });

    const decodedEvent = JSON.parse(codec.encode(recordToEvent(record))) as Record<string, unknown>;
    expect(decodedEvent).toEqual({
      time: 1700000000000,
      level: 30,
      logger: "api",
      message: "created",
      data: { orderId: "ord-1" },
    });
  });

  it("stamps the same default id on records as recordToEvent", () => {
    const record = createRecord({ time: 1700000000000, level: 30, msg: "created", seq: 7 });
    const encoded = JSON.parse(fastEventJsonCodec().encode(record)) as LogEvent;
    expect(encoded.id).toBe(recordToEvent(record).id);
  });

  it("truncates deep nesting when safe options are set", () => {
    const codec = fastEventJsonCodec({ maxDepth: 2 });
    const payload = codec.encode(sampleEvent({ data: { a: { b: { c: { d: 1 } } } } }));
    expect(JSON.parse(payload)).toMatchObject({ data: { a: { b: "[MaxDepth]" } } });
  });
});

describe("codec adapters", () => {
  it("accepts LogRecord batches through the compatibility projection", () => {
    const record = createRecord({
      time: 1,
      level: 30,
      category: ["api"],
      type: "order.created",
      tags: { service: "checkout" },
      trace: { traceId: "trace-1" },
      msg: "created",
      props: { orderId: "ord-1" },
      ctx: { requestId: "req-1" },
      source: "test",
      seq: 1,
    });

    expect(JSON.parse(fastEventJsonCodec().encode([record]))).toMatchObject([
      {
        logger: "api",
        message: "created",
        type: "order.created",
        tags: { service: "checkout" },
        trace: { traceId: "trace-1" },
        data: { orderId: "ord-1" },
        context: { requestId: "req-1" },
        source: { integration: "test" },
      },
    ]);

    expect(JSON.parse(fastEventJsonCodec().encode(record))).toMatchObject({
      logger: "api",
      message: "created",
      data: { orderId: "ord-1" },
    });

    const msgpack = msgpackrCodec({
      pack: (input) => new TextEncoder().encode(JSON.stringify(input)),
      unpack: (payload) => JSON.parse(new TextDecoder().decode(payload)) as unknown,
    });
    expect(JSON.parse(new TextDecoder().decode(msgpack.encode([record])))).toMatchObject([
      {
        logger: "api",
        message: "created",
      },
    ]);

    const projector = projectorCodec({
      name: "test-projector",
      contentType: "application/json",
      project: (input) => input,
      serialize: JSON.stringify,
    });
    expect(JSON.parse(projector.encode([record]) as string)).toMatchObject([
      {
        logger: "api",
        message: "created",
      },
    ]);
  });
});
