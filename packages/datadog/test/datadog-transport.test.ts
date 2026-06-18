import { afterEach, describe, expect, it, vi } from "vitest";
import {
  recordToEvent,
  retryTransport,
  type LogEvent,
  type TransportContext,
} from "@loggerjs/core";
import { datadogLogsTransport, type DatadogLogItem } from "../src";

const context: TransportContext = {
  loggerName: "test",
  now: () => 1,
  toEvent: recordToEvent,
  reportInternalError() {},
};

function event(message: string, patch: Partial<LogEvent> = {}): LogEvent {
  return {
    id: message,
    time: 1,
    seq: 1,
    level: 30,
    levelName: "info",
    logger: "api",
    message,
    tags: { tenant: "a" },
    data: { ok: true },
    ...patch,
  };
}

function requestJson(fetchFn: ReturnType<typeof vi.fn<typeof fetch>>): DatadogLogItem[] {
  const init = fetchFn.mock.calls[0]?.[1];
  if (!init?.body || typeof init.body !== "string") throw new Error("Missing JSON body");
  return JSON.parse(init.body) as DatadogLogItem[];
}

describe("datadogLogsTransport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends Datadog log items with API key, service, source, and tags", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(null, { status: 202 }));
    const transport = datadogLogsTransport({
      apiKey: "key",
      service: "checkout",
      source: "nodejs",
      hostname: "host-a",
      tags: { env: "prod" },
      eventTagKeys: ["tenant"],
      fetchFn,
    });

    await transport.log?.(event("created"), context);

    expect(fetchFn).toHaveBeenCalledWith(
      "https://http-intake.logs.datadoghq.com/api/v2/logs",
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
          "dd-api-key": "key",
        },
      }),
    );
    expect(requestJson(fetchFn)).toEqual([
      expect.objectContaining({
        message: "created",
        status: "info",
        service: "checkout",
        ddsource: "nodejs",
        hostname: "host-a",
        ddtags: "env:prod,tenant:a",
        logger: { name: "api" },
        loggerjs: expect.objectContaining({
          id: "created",
          data: { ok: true },
        }),
      }),
    ]);
  });

  it("supports minLevel filtering, site URLs, and status mapping", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(null, { status: 202 }));
    const transport = datadogLogsTransport({
      site: "datadoghq.eu",
      minLevel: "warn",
      status: (item) => (item.levelName === "fatal" ? "critical" : item.levelName),
      message: (item) => `${item.levelName}:${item.message}`,
      tags: ["team:platform"],
      fetchFn,
    });

    await transport.logBatch?.(
      [
        event("debug", { level: 20, levelName: "debug" }),
        event("fatal", { level: 60, levelName: "fatal" }),
      ],
      context,
    );

    expect(fetchFn.mock.calls[0]?.[0]).toBe("https://http-intake.logs.datadoghq.eu/api/v2/logs");
    expect(requestJson(fetchFn)).toEqual([
      expect.objectContaining({
        message: "fatal:fatal",
        status: "critical",
        ddtags: "team:platform",
      }),
    ]);
  });

  it("does not send when minLevel filters a single event or an entire batch", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(null, { status: 202 }));
    const transport = datadogLogsTransport({
      apiKey: "key",
      minLevel: "error",
      fetchFn,
    });

    await transport.log?.(event("debug", { level: 20, levelName: "debug" }), context);
    await transport.logBatch?.(
      [
        event("info", { level: 30, levelName: "info" }),
        event("warn", { level: 40, levelName: "warn" }),
      ],
      context,
    );

    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("throws a transport-specific error on non-2xx responses without dropping auth headers", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response("nope", { status: 503 }));
    const transport = datadogLogsTransport({
      apiKey: "key",
      headers: { "x-custom": "present" },
      fetchFn,
    });

    await expect(transport.log?.(event("failed"), context)).rejects.toThrow(
      "datadogLogsTransport failed with status 503",
    );
    expect(fetchFn.mock.calls[0]?.[1]?.headers).toMatchObject({
      "content-type": "application/json",
      "dd-api-key": "key",
      "x-custom": "present",
    });
  });

  it("propagates fetch rejections", async () => {
    const error = new TypeError("network down");
    const fetchFn = vi.fn<typeof fetch>(async () => {
      throw error;
    });
    const transport = datadogLogsTransport({ apiKey: "key", fetchFn });

    await expect(transport.log?.(event("failed"), context)).rejects.toBe(error);
  });

  it("fails explicitly when fetch is unavailable", async () => {
    vi.stubGlobal("fetch", undefined);
    const transport = datadogLogsTransport({ apiKey: "key" });

    await expect(transport.log?.(event("failed"), context)).rejects.toThrow(
      "fetch is not available for datadogLogsTransport",
    );
  });

  it("can be wrapped with retryTransport for transient delivery failures", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => {
      if (fetchFn.mock.calls.length === 1) return new Response("temporary", { status: 503 });
      return new Response(null, { status: 202 });
    });
    const transport = retryTransport(datadogLogsTransport({ apiKey: "key", fetchFn }), {
      maxRetries: 1,
      retryBaseDelayMs: 0,
      retryMaxDelayMs: 0,
    });

    await transport.log?.(event("retried"), context);

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(requestJson(fetchFn)).toEqual([expect.objectContaining({ message: "retried" })]);
  });
});
