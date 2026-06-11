import { describe, expect, it, vi } from "vitest";
import { recordToEvent, type LogEvent, type TransportContext } from "@loggerjs/core";
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
});
