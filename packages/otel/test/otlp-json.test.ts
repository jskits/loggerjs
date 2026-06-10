import { describe, expect, it, vi } from "vitest";
import { createRecord, type LogEvent } from "@loggerjs/core";
import { otlpHttpTransport, otlpJsonCodec } from "../src";

function findAttribute(
  attributes: Array<{ key: string; value: unknown }> | undefined,
  key: string,
) {
  return attributes?.find((attribute) => attribute.key === key)?.value;
}

describe("otlpJsonCodec", () => {
  it("accepts LogRecord batches through the compatibility projection", () => {
    const record = createRecord({
      time: 1,
      level: 50,
      category: ["api"],
      msg: "failed",
      seq: 1,
    });

    const payload = JSON.parse(otlpJsonCodec().encode([record]));

    expect(payload.resourceLogs[0].scopeLogs[0].logRecords[0]).toMatchObject({
      severityNumber: 17,
      severityText: "ERROR",
      body: { stringValue: "failed" },
    });
  });

  it("maps category scopes, exceptions, and trace context", () => {
    const event: LogEvent = {
      id: "evt-1",
      time: 1,
      seq: 1,
      level: 50,
      levelName: "error",
      logger: "api.http",
      message: "failed",
      error: {
        name: "TypeError",
        message: "boom",
        stack: "stacktrace",
        code: "ERR_TEST",
      },
      trace: {
        traceId: "0af7651916cd43dd8448eb211c80319c",
        spanId: "b7ad6b7169203331",
        traceFlags: "01",
      },
    };

    const payload = JSON.parse(otlpJsonCodec({ scopeVersion: "1.0.0" }).encode([event]));
    const scopeLog = payload.resourceLogs[0].scopeLogs[0];
    const logRecord = scopeLog.logRecords[0];

    expect(scopeLog.scope).toMatchObject({
      name: "loggerjs",
      version: "1.0.0",
    });
    expect(findAttribute(scopeLog.scope.attributes, "loggerjs.category")).toEqual({
      stringValue: "api.http",
    });
    expect(logRecord).toMatchObject({
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
      flags: 1,
    });
    expect(findAttribute(logRecord.attributes, "exception.type")).toEqual({
      stringValue: "TypeError",
    });
    expect(findAttribute(logRecord.attributes, "exception.message")).toEqual({
      stringValue: "boom",
    });
    expect(findAttribute(logRecord.attributes, "exception.stacktrace")).toEqual({
      stringValue: "stacktrace",
    });
    expect(findAttribute(logRecord.attributes, "exception.code")).toEqual({
      stringValue: "ERR_TEST",
    });
  });
});

describe("otlpHttpTransport", () => {
  it("uses shared batch retry options", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => {
      if (fetchFn.mock.calls.length === 1) throw new Error("temporary failure");
      return { ok: true, status: 204 } as Response;
    });
    const transport = otlpHttpTransport({
      url: "https://collector.example/v1/logs",
      flushIntervalMs: 0,
      maxRetries: 1,
      retryBaseDelayMs: 0,
      fetchFn,
    });
    const event: LogEvent = {
      id: "evt-1",
      time: 1,
      seq: 1,
      level: 30,
      levelName: "info",
      logger: "api",
      message: "created",
    };
    const context = {
      loggerName: "test",
      now: () => 1,
      reportInternalError() {},
    };

    transport.log?.(event, context);
    await transport.flush?.();

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
