import { afterEach, describe, expect, it, vi } from "vitest";
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

const binaryCodec: Codec<string | Uint8Array> = {
  name: "binary",
  contentType: "application/octet-stream",
  encode() {
    return new Uint8Array([1, 2, 3]);
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
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

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

  it("exposes the default transport name and POST method", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => okResponse);
    const transport = nodeHttpTransport({
      url: "https://collector.example/logs",
      codec: textCodec,
      flushIntervalMs: 0,
      fetchFn,
    });

    transport.log?.(createEvent("created"), createTransportContext());
    await transport.flush?.();

    expect(transport.name).toBe("node-http");
    expect(fetchFn.mock.calls[0]?.[1]?.method).toBe("POST");
  });

  it("rejects non-2xx responses and keeps the batch retryable", async () => {
    let fail = true;
    const fetchFn = vi.fn<typeof fetch>(async () => {
      if (fail) return { ok: false, status: 503 } as Response;
      return okResponse;
    });
    const transport = nodeHttpTransport({
      url: "https://collector.example/logs",
      codec: textCodec,
      flushIntervalMs: 0,
      maxRetries: 0,
      fetchFn,
    });

    transport.log?.(createEvent("retained"), createTransportContext());
    await expect(transport.flush?.()).rejects.toThrow("nodeHttpTransport failed with status 503");
    fail = false;
    await transport.flush?.();

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[1]?.[1]?.body).toBe("retained");
  });

  it("fails explicitly when fetch is unavailable", async () => {
    vi.stubGlobal("fetch", undefined);
    const transport = nodeHttpTransport({
      url: "https://collector.example/logs",
      codec: textCodec,
      flushIntervalMs: 0,
      maxRetries: 0,
    });

    transport.log?.(createEvent("created"), createTransportContext());

    await expect(transport.flush?.()).rejects.toThrow(
      "fetch is not available. Use Node.js 18+ or pass fetchFn.",
    );
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
    const transformTransports: string[] = [];
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
      transformPayload: async (payload, context) => {
        transformTransports.push(context.transport ?? "<missing>");
        return {
          payload: `${context.contentType}:${payload.toString().toUpperCase()}`,
          contentType: "application/x-logger",
          headers: { "content-encoding": "mock" },
        };
      },
    });

    transport.log?.(createEvent("compressed"), createTransportContext());
    await transport.flush?.();

    expect(bodies).toEqual(["text/plain:COMPRESSED"]);
    expect(headers[0]).toMatchObject({
      "content-type": "application/x-logger",
      "content-encoding": "mock",
    });
    expect(transformTransports).toEqual(["node-http"]);
  });

  it("uses method, binary bodies, and explicit header precedence", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => okResponse);
    const transport = nodeHttpTransport({
      url: "https://collector.example/logs",
      method: "PUT",
      codec: binaryCodec,
      headers: {
        "content-type": "application/x-explicit",
        "x-user": "configured",
      },
      flushIntervalMs: 0,
      fetchFn,
      transformPayload: () => ({
        payload: new Uint8Array([9, 8]),
        contentType: "application/x-transformed",
        headers: { "x-user": "transform", "content-encoding": "mock" },
      }),
    });

    transport.log?.(createEvent("binary"), createTransportContext());
    await transport.flush?.();

    const request = fetchFn.mock.calls[0]?.[1];
    expect(fetchFn.mock.calls[0]?.[0]).toBe("https://collector.example/logs");
    expect(request?.method).toBe("PUT");
    expect(request?.headers).toMatchObject({
      "content-type": "application/x-explicit",
      "content-encoding": "mock",
      "x-user": "configured",
    });
    expect(request?.body).toBeInstanceOf(Uint8Array);
    expect(Array.from(request?.body as Uint8Array)).toEqual([9, 8]);
  });

  it("keeps queued events when a payload transform rejects", async () => {
    let failTransform = true;
    const fetchFn = vi.fn<typeof fetch>(async () => okResponse);
    const transport = nodeHttpTransport({
      url: "https://collector.example/logs",
      codec: textCodec,
      flushIntervalMs: 0,
      maxRetries: 0,
      fetchFn,
      transformPayload(payload) {
        if (failTransform) throw new Error("transform failed");
        return payload;
      },
    });

    transport.log?.(createEvent("retained"), createTransportContext());
    await expect(transport.flush?.()).rejects.toThrow("transform failed");
    failTransform = false;
    await transport.flush?.();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[1]?.body).toBe("retained");
  });
});
