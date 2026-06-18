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

function createEvent(message: string, overrides: Partial<LogEvent> = {}): LogEvent {
  const seq = sequence++;
  return {
    id: `event-${seq}`,
    time: seq,
    seq,
    level: 30,
    levelName: "info",
    logger: "test",
    message,
    ...overrides,
  };
}

function offlineEntry(id: string, body = id): BrowserHttpOfflineEntry {
  return {
    id,
    url: "/logs",
    method: "POST",
    headers: { "content-type": textCodec.contentType },
    body,
    keepalive: true,
    createdAt: sequence++,
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
    vi.useRealTimers();
    resetLoggerMetaStats();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("memory offline queue applies drop policies and preserves replay order", async () => {
    const dropped: Array<[string, string]> = [];
    const queue = memoryBrowserHttpOfflineQueue({
      maxEntries: 2,
      onDrop(entry, reason) {
        dropped.push([entry.id, reason]);
      },
    });
    await queue.enqueue(offlineEntry("first"));
    await queue.enqueue(offlineEntry("second"));
    await queue.enqueue(offlineEntry("third"));

    const sent: string[] = [];
    await queue.replay(async (entry) => {
      sent.push(entry.id);
    });

    expect(dropped).toEqual([["first", "queue-full"]]);
    expect(sent).toEqual(["second", "third"]);
    expect(queue.size()).toBe(0);
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.offline.dropped": 1,
      "transport.offline.dropped.queue-full": 1,
    });

    resetLoggerMetaStats();
    const newestDropped: Array<[string, string]> = [];
    const dropNewestQueue = memoryBrowserHttpOfflineQueue({
      maxEntries: 1,
      dropPolicy: "drop-newest",
      onDrop(entry, reason) {
        newestDropped.push([entry.id, reason]);
      },
    });
    await dropNewestQueue.enqueue(offlineEntry("kept"));
    await dropNewestQueue.enqueue(offlineEntry("dropped"));

    const newestSent: string[] = [];
    await dropNewestQueue.replay(async (entry) => {
      newestSent.push(entry.id);
    });

    expect(newestDropped).toEqual([["dropped", "queue-full"]]);
    expect(newestSent).toEqual(["kept"]);
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.offline.dropped": 1,
      "transport.offline.dropped.queue-full": 1,
    });
  });

  it("memory offline queue keeps the failed entry when replay send rejects", async () => {
    const queue = memoryBrowserHttpOfflineQueue();
    await queue.enqueue(offlineEntry("first"));
    await queue.enqueue(offlineEntry("second"));

    await expect(
      queue.replay(async (entry) => {
        if (entry.id === "first") throw new Error("still offline");
      }),
    ).rejects.toThrow("still offline");

    expect(queue.size()).toBe(2);
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

  it("drops the oldest queued event by default when the in-memory queue is full", async () => {
    const dropped: Array<[string, string]> = [];
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const transport = browserHttpTransport({
      url: "/logs",
      codec: textCodec,
      maxQueueSize: 1,
      flushIntervalMs: 0,
      useBeaconOnPageHide: false,
      onDrop(event, reason) {
        dropped.push([event.message, reason]);
      },
      fetchFn,
    });
    const context = createTransportContext();

    transport.log?.(createEvent("old"), context);
    transport.log?.(createEvent("new"), context);
    await transport.flush?.();

    expect(dropped).toEqual([["old", "queue-full"]]);
    expect(fetchFn.mock.calls[0]?.[1]?.body).toBe("new");
  });

  it("exposes transport metadata and filters below minLevel", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const transport = browserHttpTransport({
      url: "/logs",
      name: "browser-http-custom",
      codec: textCodec,
      minLevel: "warn",
      flushIntervalMs: 0,
      useBeaconOnPageHide: false,
      fetchFn,
    });

    expect(transport.name).toBe("browser-http-custom");
    expect(transport.minLevel).toBe("warn");

    transport.log?.(
      createEvent("debug", { level: 20, levelName: "debug" }),
      createTransportContext(),
    );
    transport.log?.(
      createEvent("warn", { level: 40, levelName: "warn" }),
      createTransportContext(),
    );
    await transport.flush?.();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[1]?.body).toBe("warn");
  });

  it("uses the stable default transport name", () => {
    const transport = browserHttpTransport({
      url: "/logs",
      codec: textCodec,
      flushIntervalMs: 0,
      useBeaconOnPageHide: false,
      fetchFn: vi.fn<typeof fetch>(),
    });

    expect(transport.name).toBe("browser-http");
  });

  it("flushes automatically when maxBatchSize is reached", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const transport = browserHttpTransport({
      url: "/logs",
      codec: textCodec,
      maxBatchSize: 2,
      flushIntervalMs: 0,
      useBeaconOnPageHide: false,
      fetchFn,
    });
    const context = createTransportContext();

    transport.log?.(createEvent("one"), context);
    expect(fetchFn).not.toHaveBeenCalled();
    transport.log?.(createEvent("two"), context);
    await waitFor(() => fetchFn.mock.calls.length === 1);
    expect(fetchFn.mock.calls[0]?.[1]?.body).toBe("one|two");
  });

  it("flushes queued events on the scheduled timer", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const transport = browserHttpTransport({
      url: "/logs",
      codec: textCodec,
      flushIntervalMs: 50,
      useBeaconOnPageHide: false,
      fetchFn,
    });

    transport.log?.(createEvent("scheduled"), createTransportContext());
    expect(fetchFn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[1]?.body).toBe("scheduled");
  });

  it("reports scheduled flush failures with transport context metadata", async () => {
    vi.useFakeTimers();
    const reportInternalError = vi.fn<TransportContext["reportInternalError"]>();
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(null, { status: 503 }));
    const transport = browserHttpTransport({
      url: "/logs",
      name: "browser-http-custom",
      codec: textCodec,
      flushIntervalMs: 50,
      useBeaconOnPageHide: false,
      fetchFn,
    });

    transport.log?.(createEvent("will-fail"), {
      ...createTransportContext(),
      reportInternalError,
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(reportInternalError).toHaveBeenCalledWith(expect.any(Error), {
      phase: "transport",
      transport: "browser-http-custom",
      operation: "flush",
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

  it("throws a clear error when fetch is unavailable", async () => {
    vi.stubGlobal("fetch", undefined);
    const transport = browserHttpTransport({
      url: "/logs",
      codec: textCodec,
      flushIntervalMs: 0,
      useBeaconOnPageHide: false,
    });

    transport.log?.(createEvent("no-fetch"), createTransportContext());

    await expect(transport.flush?.()).rejects.toThrow(
      "fetch is not available for browserHttpTransport",
    );
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
    let beaconCalls = 0;
    const sendBeacon = vi.fn<Navigator["sendBeacon"]>(() => {
      beaconCalls += 1;
      return beaconCalls === 1;
    });
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

  it("falls back to fetch on close when sendBeacon is unavailable", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("navigator", {});
    const transport = browserHttpTransport({
      url: "/logs",
      codec: textCodec,
      fetchFn,
    });

    transport.log?.(createEvent("fallback"), createTransportContext());
    await transport.close?.();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[1]?.body).toBe("fallback");
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

  it("backs off before retrying offline replay failures", async () => {
    vi.useFakeTimers();
    const addEventListener = vi.fn<typeof globalThis.addEventListener>();
    vi.stubGlobal("addEventListener", addEventListener);
    const offlineQueue = memoryBrowserHttpOfflineQueue();
    await offlineQueue.enqueue(offlineEntry("offline"));
    const fetchFn = vi.fn<typeof fetch>(async () => {
      if (fetchFn.mock.calls.length === 1) throw new TypeError("still offline");
      return new Response(null, { status: 204 });
    });
    browserHttpTransport({
      url: "/logs",
      codec: textCodec,
      flushIntervalMs: 0,
      useBeaconOnPageHide: false,
      offlineQueue,
      offlineReplayMaxRetries: 1,
      offlineReplayBaseDelayMs: 100,
      offlineReplayMaxDelayMs: 1000,
      random: () => 0.5,
      fetchFn,
    });

    const onlineListener = listenerFor(addEventListener, "online");
    if (typeof onlineListener !== "function") throw new Error("online listener is not callable");
    onlineListener(new Event("online"));
    await Promise.resolve();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(49);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(offlineQueue.size()).toBe(0);
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.offline.retry": 1,
      "transport.offline.replayed": 1,
    });
  });

  it("reports offline replay failure and leaves queued entries retryable", async () => {
    const addEventListener = vi.fn<typeof globalThis.addEventListener>();
    vi.stubGlobal("addEventListener", addEventListener);
    const offlineQueue = memoryBrowserHttpOfflineQueue();
    await offlineQueue.enqueue(offlineEntry("offline"));
    const fetchFn = vi.fn<typeof fetch>(async () => {
      throw new TypeError("still offline");
    });
    browserHttpTransport({
      url: "/logs",
      codec: textCodec,
      flushIntervalMs: 0,
      useBeaconOnPageHide: false,
      offlineQueue,
      offlineReplayMaxRetries: 0,
      fetchFn,
    });

    const onlineListener = listenerFor(addEventListener, "online");
    if (typeof onlineListener !== "function") throw new Error("online listener is not callable");
    onlineListener(new Event("online"));
    await waitFor(() => getLoggerMetaStats()["transport.offline.replay.failed"] === 1);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(offlineQueue.size()).toBe(1);
  });

  it("flushes with beacon on pagehide and visibility hidden events", async () => {
    const addEventListener = vi.fn<typeof globalThis.addEventListener>();
    const sendBeacon = vi.fn<Navigator["sendBeacon"]>(() => true);
    const documentState = { visibilityState: "visible" };
    vi.stubGlobal("addEventListener", addEventListener);
    vi.stubGlobal("navigator", { sendBeacon });
    vi.stubGlobal("document", documentState);
    const transport = browserHttpTransport({
      url: "/logs",
      codec: textCodec,
      flushIntervalMs: 0,
      fetchFn: vi.fn<typeof fetch>(),
    });

    transport.log?.(createEvent("pagehide"), createTransportContext());
    const pagehideListener = listenerFor(addEventListener, "pagehide");
    if (typeof pagehideListener !== "function")
      throw new Error("pagehide listener is not callable");
    pagehideListener(new Event("pagehide"));
    expect(await blobText(beaconBodyAt(sendBeacon, 0))).toBe("pagehide");

    transport.log?.(createEvent("visible"), createTransportContext());
    const visibilityListener = listenerFor(addEventListener, "visibilitychange");
    if (typeof visibilityListener !== "function") {
      throw new Error("visibilitychange listener is not callable");
    }
    visibilityListener(new Event("visibilitychange"));
    expect(sendBeacon).toHaveBeenCalledTimes(1);

    documentState.visibilityState = "hidden";
    visibilityListener(new Event("visibilitychange"));
    expect(await blobText(beaconBodyAt(sendBeacon, 1))).toBe("visible");
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
