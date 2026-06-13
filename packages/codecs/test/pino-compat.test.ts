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
