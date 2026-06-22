import { describe, expect, it, vi } from "vitest";
import { createRecord, recordToEvent, type LogEvent } from "@loggerjs/core";
import { otlpHttpTransport, otlpJsonCodec } from "../src";

function findAttribute(
  attributes: Array<{ key: string; value: unknown }> | undefined,
  key: string,
) {
  return attributes?.find((attribute) => attribute.key === key)?.value;
}

function kvValues(value: unknown): Map<string, unknown> {
  const values = (value as { kvlistValue?: { values?: Array<{ key: string; value: unknown }> } })
    .kvlistValue?.values;
  return new Map((values ?? []).map((item) => [item.key, item.value]));
}

function logAttributeKeys(attributes: Array<{ key: string; value: unknown }> | undefined) {
  return new Set((attributes ?? []).map((attribute) => attribute.key));
}

function stringValue(value: unknown): string | undefined {
  return (value as { stringValue?: string } | undefined)?.stringValue;
}

describe("otlpJsonCodec", () => {
  it("exposes stable codec metadata", () => {
    const codec = otlpJsonCodec();

    expect(codec.name).toBe("otlp-json");
    expect(codec.contentType).toBe("application/json");
    expect(codec.decode?.('{"ok":true}')).toEqual({ ok: true });
  });

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
      timeUnixNano: "1000000",
      severityNumber: 17,
      severityText: "ERROR",
      body: { stringValue: "failed" },
    });
  });

  it("wraps a single event and falls back empty logger categories to app", () => {
    const payload = JSON.parse(
      otlpJsonCodec().encode({
        id: "evt-1",
        time: 2.5,
        seq: 1,
        level: 30,
        levelName: "info",
        logger: "",
        message: "created",
      }),
    );
    const scopeLog = payload.resourceLogs[0].scopeLogs[0];

    expect(findAttribute(scopeLog.scope.attributes, "loggerjs.category")).toEqual({
      stringValue: "app",
    });
    expect(scopeLog.logRecords).toHaveLength(1);
    expect(scopeLog.logRecords[0]).toMatchObject({
      timeUnixNano: "2500000",
      body: { stringValue: "created" },
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

  it("encodes resource attributes, scope grouping, and supported AnyValue shapes", () => {
    const codec = otlpJsonCodec({
      resource: {
        "service.name": "checkout",
        active: true,
        omitted: undefined,
      },
      scopeName: "loggerjs-tests",
      scopeVersion: "2.0.0",
    });
    const events: LogEvent[] = [
      {
        id: "evt-api-1",
        time: 1,
        seq: 1,
        level: 30,
        levelName: "info",
        logger: "api",
        message: "created",
        data: {
          text: "cart",
          ok: true,
          count: 2,
          ratio: 1.5,
          nil: null,
          list: ["x", 2],
          child: { nested: false },
        },
      },
      {
        id: "evt-worker",
        time: 2,
        seq: 2,
        level: 40,
        levelName: "warn",
        logger: "worker",
        message: "delayed",
      },
      {
        id: "evt-api-2",
        time: 3,
        seq: 3,
        level: 30,
        levelName: "info",
        logger: "api",
        message: "updated",
      },
    ];

    const payload = JSON.parse(codec.encode(events));
    const resource = payload.resourceLogs[0].resource;
    const scopeLogs = payload.resourceLogs[0].scopeLogs;
    const apiScope = scopeLogs.find(
      (scopeLog: { scope: { attributes: Array<{ key: string; value: unknown }> } }) =>
        stringValue(findAttribute(scopeLog.scope.attributes, "loggerjs.category")) === "api",
    );
    const workerScope = scopeLogs.find(
      (scopeLog: { scope: { attributes: Array<{ key: string; value: unknown }> } }) =>
        stringValue(findAttribute(scopeLog.scope.attributes, "loggerjs.category")) === "worker",
    );
    const apiRecord = apiScope.logRecords[0];
    const data = kvValues(findAttribute(apiRecord.attributes, "log.data"));

    expect(findAttribute(resource.attributes, "service.name")).toEqual({
      stringValue: "checkout",
    });
    expect(findAttribute(resource.attributes, "active")).toEqual({ boolValue: true });
    expect(logAttributeKeys(resource.attributes)).not.toContain("omitted");
    expect(scopeLogs).toHaveLength(2);
    expect(apiScope.scope).toMatchObject({ name: "loggerjs-tests", version: "2.0.0" });
    expect(apiScope.logRecords).toHaveLength(2);
    expect(workerScope.logRecords).toHaveLength(1);
    expect(data.get("text")).toEqual({ stringValue: "cart" });
    expect(data.get("ok")).toEqual({ boolValue: true });
    expect(data.get("count")).toEqual({ intValue: 2 });
    expect(data.get("ratio")).toEqual({ doubleValue: 1.5 });
    expect(data.get("nil")).toEqual({});
    expect(data.get("list")).toEqual({
      arrayValue: { values: [{ stringValue: "x" }, { intValue: 2 }] },
    });
    expect(kvValues(data.get("child")).get("nested")).toEqual({ boolValue: false });
    expect(logAttributeKeys(apiRecord.attributes)).not.toContain("log.type");
    expect(logAttributeKeys(apiRecord.attributes)).not.toContain("log.source");
  });

  it("falls back from invalid traceFlags to sampled trace flags", () => {
    const payload = JSON.parse(
      otlpJsonCodec().encode([
        {
          id: "evt-1",
          time: 1,
          seq: 1,
          level: 30,
          levelName: "info",
          logger: "api",
          message: "created",
          trace: {
            traceId: "0af7651916cd43dd8448eb211c80319c",
            spanId: "b7ad6b7169203331",
            traceFlags: "not-hex",
            sampled: true,
          },
        },
      ]),
    );

    expect(payload.resourceLogs[0].scopeLogs[0].logRecords[0].flags).toBe(1);
  });
});

describe("otlpHttpTransport", () => {
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
    toEvent: recordToEvent,
    reportInternalError() {},
  };

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

    transport.log?.(event, context);
    await transport.flush?.();

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("posts OTLP JSON with default content type and custom headers", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => ({ ok: true, status: 204 }) as Response);
    const transport = otlpHttpTransport({
      url: "https://collector.example/v1/logs",
      flushIntervalMs: 0,
      headers: { authorization: "Bearer token" },
      fetchFn,
    });

    transport.log?.(event, context);
    await transport.flush?.();

    const [url, init] = fetchFn.mock.calls[0] ?? [];
    const payload = JSON.parse(String(init?.body));
    expect(url).toBe("https://collector.example/v1/logs");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer token",
      },
    });
    expect(payload.resourceLogs[0].scopeLogs[0].logRecords[0]).toMatchObject({
      body: { stringValue: "created" },
      severityText: "INFO",
    });
  });

  it("throws a transport-specific error on non-2xx responses", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => ({ ok: false, status: 503 }) as Response);
    const transport = otlpHttpTransport({
      url: "https://collector.example/v1/logs",
      flushIntervalMs: 0,
      maxRetries: 0,
      fetchFn,
    });

    transport.log?.(event, context);

    await expect(transport.flush?.()).rejects.toThrow("otlpHttpTransport failed with status 503");
  });

  it("propagates fetch rejections when retries are exhausted", async () => {
    const error = new Error("collector unavailable");
    const fetchFn = vi.fn<typeof fetch>(async () => {
      throw error;
    });
    const transport = otlpHttpTransport({
      url: "https://collector.example/v1/logs",
      flushIntervalMs: 0,
      maxRetries: 0,
      fetchFn,
    });

    transport.log?.(event, context);

    await expect(transport.flush?.()).rejects.toBe(error);
  });

  it("filters below minLevel before sending", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => ({ ok: true, status: 204 }) as Response);
    const transport = otlpHttpTransport({
      url: "https://collector.example/v1/logs",
      flushIntervalMs: 0,
      minLevel: "warn",
      fetchFn,
    });

    transport.log?.(event, context);
    await transport.flush?.();

    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("throws a clear error when fetch is unavailable", async () => {
    const originalFetch = globalThis.fetch;
    try {
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        value: undefined,
        writable: true,
      });
      const transport = otlpHttpTransport({
        url: "https://collector.example/v1/logs",
        flushIntervalMs: 0,
        maxRetries: 0,
      });

      transport.log?.(event, context);

      await expect(transport.flush?.()).rejects.toThrow(
        "fetch is not available. Use Node.js 18+ or pass fetchFn.",
      );
    } finally {
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        value: originalFetch,
        writable: true,
      });
    }
  });
});
