import { describe, expect, it, vi } from "vitest";
import type { LogEvent, TransportContext } from "@loggerjs/core";
import {
  createElasticBulkPayload,
  elasticTransport,
  toElasticDocument,
  type ElasticBulkAction,
} from "../src";

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

function bulkLines(fetchFn: ReturnType<typeof vi.fn<typeof fetch>>): unknown[] {
  const init = fetchFn.mock.calls[0]?.[1];
  if (!init?.body || typeof init.body !== "string") throw new Error("Missing NDJSON body");
  return init.body
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as unknown);
}

describe("elasticTransport", () => {
  it("creates Elasticsearch bulk NDJSON with action metadata and documents", () => {
    const payload = createElasticBulkPayload([event("created")], {
      id: (item) => item.id,
      index: "logs-api",
      pipeline: "loggerjs",
    });
    const lines = payload
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as ElasticBulkAction | Record<string, unknown>);

    expect(lines[0]).toEqual({
      index: {
        _id: "created",
        _index: "logs-api",
        pipeline: "loggerjs",
      },
    });
    expect(lines[1]).toMatchObject({
      "@timestamp": "1970-01-01T00:00:00.001Z",
      data: { ok: true },
      labels: { tenant: "a" },
      log: { level: "info", logger: "api" },
      message: "created",
    });
  });

  it("sends bulk payloads with API key and refresh query", async () => {
    const fetchFn = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ errors: false }), { status: 200 }),
    );
    const transport = elasticTransport({
      url: "https://elastic.example.com",
      index: (item) => `logs-${item.logger}`,
      apiKey: "key",
      refresh: "wait_for",
      id: (item) => item.id,
      fetchFn,
    });

    await transport.log?.(event("created"), context);

    expect(fetchFn).toHaveBeenCalledWith(
      "https://elastic.example.com/_bulk?refresh=wait_for",
      expect.objectContaining({
        method: "POST",
        headers: {
          authorization: "ApiKey key",
          "content-type": "application/x-ndjson",
        },
      }),
    );
    expect(bulkLines(fetchFn)[0]).toEqual({
      index: {
        _id: "created",
        _index: "logs-api",
      },
    });
  });

  it("filters batches by minLevel and supports custom documents", async () => {
    const fetchFn = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ errors: false }), { status: 200 }),
    );
    const transport = elasticTransport({
      url: "https://elastic.example.com/_bulk",
      minLevel: "warn",
      opType: "create",
      document: (item) => ({ message: item.message, severity: item.levelName }),
      fetchFn,
    });

    await transport.logBatch?.(
      [
        event("debug", { level: 20, levelName: "debug" }),
        event("warn", { level: 40, levelName: "warn" }),
      ],
      context,
    );

    expect(bulkLines(fetchFn)).toEqual([{ create: {} }, { message: "warn", severity: "warn" }]);
  });

  it("throws when the bulk response contains item errors", async () => {
    const fetchFn = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ errors: true }), { status: 200 }),
    );
    const transport = elasticTransport({
      url: "https://elastic.example.com",
      fetchFn,
    });

    await expect(transport.log?.(event("failed"), context)).rejects.toThrow(
      "bulk response contains item errors",
    );
  });

  it("keeps the default document compact", () => {
    expect(toElasticDocument(event("created"))).toMatchObject({
      loggerjs: { id: "created", level: 30 },
      message: "created",
    });
  });
});
