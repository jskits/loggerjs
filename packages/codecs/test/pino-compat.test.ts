import { describe, expect, it } from "vitest";
import pino from "pino";
import { createRecord, type LogEvent } from "@loggerjs/core";
import { pinoCompatCodec, pinoNdjsonProjector } from "../src";

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

function pinoLine(data: Record<string, unknown>, message: string): string {
  let output = "";
  const logger = pino(
    {
      base: { pid: 123, hostname: "host" },
      timestamp: () => ',"time":1',
    },
    {
      write(line: string) {
        output += line;
      },
    },
  );
  logger.info(data, message);
  return output;
}

describe("pinoCompatCodec", () => {
  it("matches pino bytes for the common merged data field set", () => {
    const codec = pinoCompatCodec({
      base: { pid: 123, hostname: "host" },
      mergeData: true,
    });

    expect(codec.encode(sampleEvent({ data: { orderId: "ord-1" } }))).toBe(
      pinoLine({ orderId: "ord-1" }, "created"),
    );
  });

  it("keeps LoggerJS data nested unless root merging is explicit", () => {
    const decoded = JSON.parse(
      pinoCompatCodec({ base: { pid: 123, hostname: "host" } }).encode(
        sampleEvent({ data: { orderId: "ord-1" } }),
      ),
    ) as Record<string, unknown>;

    expect(decoded).toEqual({
      level: 30,
      time: 1,
      pid: 123,
      hostname: "host",
      data: { orderId: "ord-1" },
      msg: "created",
    });
  });

  it("nests reserved root key collisions by default", () => {
    const decoded = JSON.parse(
      pinoCompatCodec({ mergeData: true }).encode(
        sampleEvent({ data: { level: "user-level", orderId: "ord-1" } }),
      ),
    ) as Record<string, unknown>;

    expect(decoded).toEqual({
      level: 30,
      time: 1,
      orderId: "ord-1",
      data: { level: "user-level" },
      msg: "created",
    });
  });

  it("can reject root key collisions", () => {
    const codec = pinoCompatCodec({ mergeData: true, collision: "throw" });

    expect(() => codec.encode(sampleEvent({ data: { msg: "user message" } }))).toThrow(
      'pinoCompatCodec cannot merge reserved key "msg"',
    );
  });

  it("can drop reserved root key collisions", () => {
    const decoded = JSON.parse(
      pinoCompatCodec({
        base: { pid: 123, time: "base-time" },
        mergeData: true,
        collision: "drop",
      }).encode(sampleEvent({ data: { msg: "user message", orderId: "ord-1" } })),
    ) as Record<string, unknown>;

    expect(decoded).toEqual({
      level: 30,
      time: 1,
      pid: 123,
      orderId: "ord-1",
      msg: "created",
    });
  });

  it("supports custom data/error keys and logger output", () => {
    const decoded = JSON.parse(
      pinoCompatCodec({
        dataKey: "payload",
        errorKey: "error",
        includeLogger: true,
      }).encode(
        sampleEvent({
          data: { orderId: "ord-1" },
          error: { name: "TypeError", message: "bad input", cause: { code: "CAUSE" } },
        }),
      ),
    ) as Record<string, unknown>;

    expect(decoded).toMatchObject({
      level: 30,
      time: 1,
      logger: "api",
      payload: { orderId: "ord-1" },
      error: {
        type: "TypeError",
        message: "bad input",
        cause: { code: "CAUSE" },
      },
      msg: "created",
    });
  });

  it("merges nested collisions with existing object and scalar data", () => {
    const withObject = JSON.parse(
      pinoCompatCodec({ base: { data: "base-data" } }).encode(
        sampleEvent({ data: { orderId: "ord-1" } }),
      ),
    ) as Record<string, unknown>;
    expect(withObject.data).toEqual({ data: "base-data", orderId: "ord-1" });

    const withScalar = JSON.parse(
      pinoCompatCodec({ base: { data: "base-data" } }).encode(sampleEvent({ data: "payload" })),
    ) as Record<string, unknown>;
    expect(withScalar.data).toEqual({ data: "base-data", value: "payload" });
  });

  it("falls back safely for values native JSON cannot encode", () => {
    const decoded = JSON.parse(
      pinoCompatCodec().encode(sampleEvent({ data: { big: 10n } })),
    ) as Record<string, { big?: string }>;

    expect(decoded.data).toEqual({ big: "10" });
  });

  it("uses safe stringify when safe options are configured", () => {
    const decoded = JSON.parse(
      pinoCompatCodec({ maxDepth: 2 }).encode(
        sampleEvent({ data: { outer: { inner: { value: 1 } } } }),
      ),
    ) as Record<string, unknown>;

    expect(decoded.data).toEqual({ outer: "[MaxDepth]" });
  });

  it("projects LoggerJS errors into pino-style err objects", () => {
    const decoded = JSON.parse(
      pinoCompatCodec().encode(
        sampleEvent({
          level: 50,
          levelName: "error",
          message: "failed",
          error: { name: "Error", message: "boom", stack: "stack", code: "E_TEST" },
        }),
      ),
    ) as Record<string, { code?: string; message?: string; stack?: string; type?: string }>;

    expect(decoded.err).toEqual({
      type: "Error",
      message: "boom",
      stack: "stack",
      code: "E_TEST",
    });
  });

  it("accepts records and exposes a pinoNdjsonProjector alias", () => {
    const record = createRecord({
      time: 1,
      level: 30,
      category: ["api"],
      msg: "created",
      props: { orderId: "ord-1" },
      seq: 1,
    });

    expect(pinoNdjsonProjector({ mergeData: true }).encode(record)).toBe(
      '{"level":30,"time":1,"orderId":"ord-1","msg":"created"}\n',
    );
  });
});
