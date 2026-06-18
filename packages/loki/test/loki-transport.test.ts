import { afterEach, describe, expect, it, vi } from "vitest";
import {
  recordToEvent,
  retryTransport,
  type LogEvent,
  type TransportContext,
} from "@loggerjs/core";
import { lokiTransport, type LokiPushPayload } from "../src";

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
    ...patch,
  };
}

async function requestJson(
  fetchFn: ReturnType<typeof vi.fn<typeof fetch>>,
): Promise<LokiPushPayload> {
  const init = fetchFn.mock.calls[0]?.[1];
  if (!init?.body || typeof init.body !== "string") throw new Error("Missing JSON body");
  return JSON.parse(init.body) as LokiPushPayload;
}

describe("lokiTransport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends Loki push payloads grouped by stream labels", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const transport = lokiTransport({
      url: "https://loki.example.test/loki/api/v1/push",
      labels: { service: "checkout" },
      labelTags: ["tenant"],
      fetchFn,
    });

    await transport.logBatch?.(
      [
        event("created"),
        event("failed", { level: 50, levelName: "error", error: { message: "boom" } }),
      ],
      context,
    );

    expect(fetchFn).toHaveBeenCalledWith(
      "https://loki.example.test/loki/api/v1/push",
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
      }),
    );
    const payload = await requestJson(fetchFn);
    expect(payload.streams).toHaveLength(2);
    expect(payload.streams[0]?.stream).toMatchObject({
      level: "info",
      logger: "api",
      service: "checkout",
      tenant: "a",
    });
    expect(payload.streams[0]?.values[0]?.[1]).toBe("created");
    expect(payload.streams[0]?.values[0]?.[2]).toMatchObject({
      id: "created",
      tags: { tenant: "a" },
    });
  });

  it("supports tenant headers, minLevel, and line formatting", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const transport = lokiTransport({
      url: "/loki",
      minLevel: "warn",
      tenantId: "tenant-a",
      structuredMetadata: false,
      line: (item) => `${item.levelName}:${item.message}`,
      fetchFn,
    });

    await transport.logBatch?.(
      [
        event("debug", { level: 20, levelName: "debug" }),
        event("warn", { level: 40, levelName: "warn" }),
      ],
      context,
    );

    expect(fetchFn.mock.calls[0]?.[1]?.headers).toMatchObject({
      "x-scope-orgid": "tenant-a",
    });
    const payload = await requestJson(fetchFn);
    expect(payload.streams).toHaveLength(1);
    expect(payload.streams[0]?.values).toEqual([["1000000", "warn:warn"]]);
  });

  it("does not send when minLevel filters a single event or an entire batch", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const transport = lokiTransport({
      url: "/loki",
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

  it("throws a transport-specific error on non-2xx responses without dropping tenant headers", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response("nope", { status: 429 }));
    const transport = lokiTransport({
      url: "/loki",
      headers: { "x-custom": "present" },
      tenantId: "tenant-a",
      fetchFn,
    });

    await expect(transport.log?.(event("failed"), context)).rejects.toThrow(
      "lokiTransport failed with status 429",
    );
    expect(fetchFn.mock.calls[0]?.[1]?.headers).toMatchObject({
      "content-type": "application/json",
      "x-custom": "present",
      "x-scope-orgid": "tenant-a",
    });
  });

  it("propagates fetch rejections", async () => {
    const error = new TypeError("network down");
    const fetchFn = vi.fn<typeof fetch>(async () => {
      throw error;
    });
    const transport = lokiTransport({ url: "/loki", fetchFn });

    await expect(transport.log?.(event("failed"), context)).rejects.toBe(error);
  });

  it("fails explicitly when fetch is unavailable", async () => {
    vi.stubGlobal("fetch", undefined);
    const transport = lokiTransport({ url: "/loki" });

    await expect(transport.log?.(event("failed"), context)).rejects.toThrow(
      "fetch is not available for lokiTransport",
    );
  });

  it("can be wrapped with retryTransport for transient delivery failures", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => {
      if (fetchFn.mock.calls.length === 1) return new Response("temporary", { status: 503 });
      return new Response(null, { status: 204 });
    });
    const transport = retryTransport(lokiTransport({ url: "/loki", fetchFn }), {
      maxRetries: 1,
      retryBaseDelayMs: 0,
      retryMaxDelayMs: 0,
    });

    await transport.log?.(event("retried"), context);

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect((await requestJson(fetchFn)).streams[0]?.values[0]?.[1]).toBe("retried");
  });
});
