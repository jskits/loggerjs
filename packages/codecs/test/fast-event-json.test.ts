import { describe, expect, it } from "vitest";
import { createRecord, type LogEvent } from "@loggerjs/core";
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
