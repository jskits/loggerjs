import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getLoggerMetaStats,
  recordToEvent,
  resetLoggerMetaStats,
  type Codec,
  type LogEvent,
  type TransportContext,
} from "@loggerjs/core";
import {
  browserHttpTransport,
  memoryBrowserHttpOfflineQueue,
  type BrowserHttpOfflineEntry,
  type BrowserHttpOfflineQueue,
} from "../src";

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

async function blobText(value: unknown): Promise<string> {
  return (value as Blob).text();
}

function createTransportContext(): TransportContext {
  return {
    loggerName: "test",
    now: () => 0,
    toEvent: recordToEvent,
    reportInternalError: vi.fn<TransportContext["reportInternalError"]>(),
  };
}

function beaconBodyAt(
  sendBeacon: ReturnType<typeof vi.fn<Navigator["sendBeacon"]>>,
  index: number,
) {
  const call = sendBeacon.mock.calls[index];
  if (!call) throw new Error(`Missing sendBeacon call at index ${index}`);
  return call[1];
}

function listenerFor(
  addEventListener: ReturnType<typeof vi.fn<typeof globalThis.addEventListener>>,
  type: string,
) {
  const call = addEventListener.mock.calls.find(([eventType]) => eventType === type);
  if (!call) throw new Error(`Missing ${type} listener`);
  return call[1];
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (predicate()) return;
    // oxlint-disable-next-line no-await-in-loop -- Polling waits for the async online replay callback.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for condition");
}

describe("browserHttpTransport", () => {
  afterEach(() => {
    resetLoggerMetaStats();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("splits beacon payloads around the configured byte budget", async () => {
    const sendBeacon = vi.fn<Navigator["sendBeacon"]>(() => true);
    const fetchFn = vi.fn<typeof fetch>();
    vi.stubGlobal("navigator", { sendBeacon });

    const transport = browserHttpTransport({
      url: "/logs",
      codec: textCodec,
      beaconMaxBytes: 5,
      useBeaconOnPageHide: false,
      fetchFn,
    });
    const context = createTransportContext();

    transport.log?.(createEvent("aa"), context);
    transport.log?.(createEvent("bb"), context);
    transport.log?.(createEvent("cc"), context);

    await transport.close?.();

    expect(sendBeacon).toHaveBeenCalledTimes(2);
    expect(await blobText(beaconBodyAt(sendBeacon, 0))).toBe("aa|bb");
    expect(await blobText(beaconBodyAt(sendBeacon, 1))).toBe("cc");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("counts queue drops through logger meta counters", () => {
    const dropped: Array<[string, string]> = [];
    const transport = browserHttpTransport({
      url: "/logs",
      codec: textCodec,
      maxQueueSize: 1,
      flushIntervalMs: 0,
      dropPolicy: "drop-newest",
      useBeaconOnPageHide: false,
      onDrop(event, reason) {
        dropped.push([event.message, reason]);
      },
    });
    const context = createTransportContext();

    transport.log?.(createEvent("kept"), context);
    transport.log?.(createEvent("dropped"), context);

    expect(dropped).toEqual([["dropped", "queue-full"]]);
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.dropped": 1,
      "transport.dropped.queue-full": 1,
    });
  });

  it("stores encoded payloads when fetch fails", async () => {
    const entries: BrowserHttpOfflineEntry[] = [];
    const offlineQueue: BrowserHttpOfflineQueue = {
      enqueue(entry) {
        entries.push(entry);
      },
      replay() {},
    };
    const fetchFn = vi.fn<typeof fetch>(async () => {
      throw new TypeError("offline");
    });
    const transport = browserHttpTransport({
      url: "/logs",
      codec: textCodec,
      flushIntervalMs: 0,
      useBeaconOnPageHide: false,
      offlineQueue,
      fetchFn,
    });

    transport.log?.(createEvent("queued"), createTransportContext());
    await transport.flush?.();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.body).toBe("queued");
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.offline.queued": 1,
    });
  });

  it("stores encoded payloads when fetch returns a non-2xx response", async () => {
    const entries: BrowserHttpOfflineEntry[] = [];
    const offlineQueue: BrowserHttpOfflineQueue = {
      enqueue(entry) {
        entries.push(entry);
      },
      replay() {},
    };
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(null, { status: 503 }));
    const transport = browserHttpTransport({
      url: "/logs",
      codec: textCodec,
      method: "PUT",
      credentials: "include",
      keepalive: false,
      flushIntervalMs: 0,
      useBeaconOnPageHide: false,
      offlineQueue,
      fetchFn,
    });

    transport.log?.(createEvent("server-down"), createTransportContext());
    await transport.flush?.();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      url: "/logs",
      method: "PUT",
      credentials: "include",
      keepalive: false,
      body: "server-down",
    });
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.offline.queued": 1,
    });
  });

  it("queues without fetch when the browser is already offline", async () => {
    const entries: BrowserHttpOfflineEntry[] = [];
    const offlineQueue: BrowserHttpOfflineQueue = {
      enqueue(entry) {
        entries.push(entry);
      },
      replay() {},
    };
    const fetchFn = vi.fn<typeof fetch>();
    vi.stubGlobal("navigator", { onLine: false });
    const transport = browserHttpTransport({
      url: "/logs",
      codec: textCodec,
      flushIntervalMs: 0,
      useBeaconOnPageHide: false,
      offlineQueue,
      fetchFn,
    });

    transport.log?.(createEvent("offline"), createTransportContext());
    await transport.flush?.();

    expect(fetchFn).not.toHaveBeenCalled();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.body).toBe("offline");
  });

  it("retains the batch when fetch fails and no offline queue is configured", async () => {
    let fail = true;
    const fetchFn = vi.fn<typeof fetch>(async () => {
      if (fail) return new Response(null, { status: 500 });
      return new Response(null, { status: 204 });
    });
    const transport = browserHttpTransport({
      url: "/logs",
      codec: textCodec,
      flushIntervalMs: 0,
      useBeaconOnPageHide: false,
      fetchFn,
    });

    transport.log?.(createEvent("retained"), createTransportContext());
    await expect(transport.flush?.()).rejects.toThrow(
      "browserHttpTransport failed with status 500",
    );
    fail = false;
    await transport.flush?.();

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[1]?.[1]?.body).toBe("retained");
  });

  it("transforms encoded payloads before fetch and offline storage", async () => {
    const entries: BrowserHttpOfflineEntry[] = [];
    const offlineQueue: BrowserHttpOfflineQueue = {
      enqueue(entry) {
        entries.push(entry);
      },
      replay() {},
    };
    const fetchFn = vi.fn<typeof fetch>(async () => {
      throw new TypeError("offline");
    });
    const transport = browserHttpTransport({
      url: "/logs",
      codec: textCodec,
      flushIntervalMs: 0,
      useBeaconOnPageHide: false,
      offlineQueue,
      fetchFn,
      transformPayload: async (payload, context) => ({
        payload: `${context.contentType}:${payload.toString().toUpperCase()}`,
        contentType: "application/x-logger",
        headers: { "content-encoding": "mock" },
      }),
    });

    transport.log?.(createEvent("secret"), createTransportContext());
    await transport.flush?.();

    expect(entries[0]?.body).toBe("text/plain:SECRET");
    expect(entries[0]?.headers).toMatchObject({
      "content-type": "application/x-logger",
      "content-encoding": "mock",
    });
  });

  it("keeps queued events when a payload transform fails", async () => {
    let failTransform = true;
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const transport = browserHttpTransport({
      url: "/logs",
      codec: textCodec,
      flushIntervalMs: 0,
      useBeaconOnPageHide: false,
      fetchFn,
      transformPayload(payload) {
        if (failTransform) throw new Error("transform unavailable");
        return payload;
      },
    });

    transport.log?.(createEvent("retained"), createTransportContext());

    await expect(transport.flush?.()).rejects.toThrow("transform unavailable");
    failTransform = false;
    await transport.flush?.();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[1]?.body).toBe("retained");
  });

  it("uses transformed headers and lets explicit transport headers win", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const transport = browserHttpTransport({
      url: "/logs",
      codec: textCodec,
      method: "PUT",
      headers: {
        "content-type": "application/x-explicit",
        "x-user": "configured",
      },
      credentials: "omit",
      keepalive: false,
      flushIntervalMs: 0,
      useBeaconOnPageHide: false,
      fetchFn,
      transformPayload: () => ({
        payload: new Uint8Array([1, 2, 3]),
        contentType: "application/x-transformed",
        headers: { "x-user": "transform", "content-encoding": "mock" },
      }),
    });

    transport.log?.(createEvent("binary"), createTransportContext());
    await transport.flush?.();

    const request = fetchFn.mock.calls[0]?.[1];
    expect(fetchFn.mock.calls[0]?.[0]).toBe("/logs");
    expect(request).toMatchObject({
      method: "PUT",
      credentials: "omit",
      keepalive: false,
    });
    expect(request?.headers).toMatchObject({
      "content-type": "application/x-explicit",
      "content-encoding": "mock",
      "x-user": "configured",
    });
    expect(request?.body).toBeInstanceOf(Uint8Array);
    expect(Array.from(request?.body as Uint8Array)).toEqual([1, 2, 3]);
  });

  it("falls back from a partial beacon send to fetch with only remaining events", async () => {
    const sendBeacon = vi.fn<Navigator["sendBeacon"]>(() => sendBeacon.mock.calls.length === 1);
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("navigator", { sendBeacon });
    const transport = browserHttpTransport({
      url: "/logs",
      codec: textCodec,
      beaconMaxBytes: 5,
      fetchFn,
    });

    transport.log?.(createEvent("aa"), createTransportContext());
    transport.log?.(createEvent("bb"), createTransportContext());
    transport.log?.(createEvent("cc"), createTransportContext());
    await transport.close?.();

    expect(sendBeacon).toHaveBeenCalledTimes(2);
    expect(await blobText(beaconBodyAt(sendBeacon, 0))).toBe("aa|bb");
    expect(await blobText(beaconBodyAt(sendBeacon, 1))).toBe("cc");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[1]?.body).toBe("cc");
  });

  it("drops oversized beacon events instead of sending an empty payload", async () => {
    const dropped: Array<[string, string]> = [];
    const sendBeacon = vi.fn<Navigator["sendBeacon"]>(() => true);
    const fetchFn = vi.fn<typeof fetch>();
    vi.stubGlobal("navigator", { sendBeacon });
    const transport = browserHttpTransport({
      url: "/logs",
      codec: textCodec,
      beaconMaxBytes: 2,
      fetchFn,
      onDrop(event, reason) {
        dropped.push([event.message, reason]);
      },
    });

    transport.log?.(createEvent("large"), createTransportContext());
    await transport.close?.();

    expect(sendBeacon).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(dropped).toEqual([["large", "beacon-too-large"]]);
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.dropped": 1,
      "transport.dropped.beacon-too-large": 1,
    });
  });

  it("replays offline payloads on online with retry", async () => {
    const addEventListener = vi.fn<typeof globalThis.addEventListener>();
    const removeEventListener = vi.fn<typeof globalThis.removeEventListener>();
    vi.stubGlobal("addEventListener", addEventListener);
    vi.stubGlobal("removeEventListener", removeEventListener);
    const offlineQueue = memoryBrowserHttpOfflineQueue();
    await offlineQueue.enqueue({
      id: "offline-1",
      url: "/logs",
      method: "POST",
      headers: { "content-type": textCodec.contentType },
      body: "stored",
      keepalive: true,
      createdAt: 1,
    });
    const fetchFn = vi.fn<typeof fetch>(async () => {
      if (fetchFn.mock.calls.length === 1) throw new TypeError("still offline");
      return new Response(null, { status: 204 });
    });
    const transport = browserHttpTransport({
      url: "/logs",
      codec: textCodec,
      flushIntervalMs: 0,
      useBeaconOnPageHide: false,
      offlineQueue,
      offlineReplayMaxRetries: 1,
      offlineReplayBaseDelayMs: 0,
      fetchFn,
    });

    const onlineListener = listenerFor(addEventListener, "online");
    if (typeof onlineListener !== "function") throw new Error("online listener is not callable");
    onlineListener(new Event("online"));
    await waitFor(() => fetchFn.mock.calls.length === 2);

    expect(offlineQueue.size()).toBe(0);
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.offline.retry": 1,
      "transport.offline.replayed": 1,
    });

    await transport.close?.();
    expect(removeEventListener).toHaveBeenCalledWith("online", onlineListener);
  });

  it("removes pagehide and visibilitychange listeners on close", async () => {
    const addEventListener = vi.fn<typeof globalThis.addEventListener>();
    const removeEventListener = vi.fn<typeof globalThis.removeEventListener>();
    vi.stubGlobal("addEventListener", addEventListener);
    vi.stubGlobal("removeEventListener", removeEventListener);

    const transport = browserHttpTransport({
      url: "/logs",
      codec: textCodec,
      flushIntervalMs: 0,
    });

    await transport.close?.();

    expect(removeEventListener).toHaveBeenCalledWith(
      "pagehide",
      listenerFor(addEventListener, "pagehide"),
    );
    expect(removeEventListener).toHaveBeenCalledWith(
      "visibilitychange",
      listenerFor(addEventListener, "visibilitychange"),
    );
  });
});
