import { describe, expect, it, vi } from "vitest";
import type { LogEvent, TransportContext } from "@loggerjs/core";
import { datadogLogsTransport, type DatadogLogItem } from "../src";

const context: TransportContext = {
  loggerName: "test",
  now: () => 1,
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
});
