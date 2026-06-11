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
