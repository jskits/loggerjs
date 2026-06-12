import { describe, expect, it, vi } from "vitest";
import { recordToEvent, type Codec, type LogEvent, type TransportContext } from "@loggerjs/core";
import { nodeHttpTransport } from "../src";

let sequence = 0;

const textCodec: Codec<string | Uint8Array> = {
  name: "text",
  contentType: "text/plain",
  encode(input) {
    const items = Array.isArray(input) ? input : [input];
    return items
      .map((item) => {
        if ("message" in item) return item.message;
        return item.msg ?? "";
      })
      .join("|");
  },
};

function createEvent(message: string): LogEvent {
  const seq = sequence++;
  return {
    id: `event-${seq}`,
    time: seq,
    seq,
    level: 30,
    levelName: "info",
    logger: "test",
    message,
  };
}

function createTransportContext(): TransportContext {
  return {
    loggerName: "test",
    now: () => 0,
    toEvent: recordToEvent,
    reportInternalError: vi.fn<TransportContext["reportInternalError"]>(),
  };
}

const okResponse = { ok: true, status: 204 } as Response;

describe("nodeHttpTransport", () => {
  it("uses shared batch retry options", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => {
      if (fetchFn.mock.calls.length === 1) throw new Error("temporary failure");
      return okResponse;
    });
    const transport = nodeHttpTransport({
      url: "https://collector.example/logs",
      codec: textCodec,
      flushIntervalMs: 0,
      maxRetries: 1,
      retryBaseDelayMs: 0,
      fetchFn,
    });

    transport.log?.(createEvent("created"), createTransportContext());
    await transport.flush?.();

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("uses shared byte bounded batches", async () => {
    const bodies: string[] = [];
    const fetchFn = vi.fn<typeof fetch>(async (_url, init) => {
      if (typeof init?.body === "string") bodies.push(init.body);
      return okResponse;
    });
    const transport = nodeHttpTransport({
      url: "https://collector.example/logs",
      codec: textCodec,
      maxBatchSize: 10,
      maxBytes: 5,
      flushIntervalMs: 0,
      estimateEventBytes(event) {
        return event.message === "c" ? 2 : 3;
      },
      fetchFn,
    });
    const context = createTransportContext();

    transport.log?.(createEvent("aa"), context);
    transport.log?.(createEvent("bb"), context);
    transport.log?.(createEvent("c"), context);
    await transport.flush?.();

    expect(bodies).toEqual(["aa", "bb|c"]);
  });

  it("transforms encoded payloads before fetch", async () => {
    const bodies: string[] = [];
    const headers: HeadersInit[] = [];
    const fetchFn = vi.fn<typeof fetch>(async (_url, init) => {
      if (typeof init?.body === "string") bodies.push(init.body);
      if (init?.headers) headers.push(init.headers);
      return okResponse;
    });
    const transport = nodeHttpTransport({
      url: "https://collector.example/logs",
      codec: textCodec,
      flushIntervalMs: 0,
      fetchFn,
      transformPayload: async (payload, context) => ({
        payload: `${context.contentType}:${payload.toString().toUpperCase()}`,
        contentType: "application/x-logger",
        headers: { "content-encoding": "mock" },
      }),
    });

    transport.log?.(createEvent("compressed"), createTransportContext());
    await transport.flush?.();

    expect(bodies).toEqual(["text/plain:COMPRESSED"]);
    expect(headers[0]).toMatchObject({
      "content-type": "application/x-logger",
      "content-encoding": "mock",
    });
  });
});
