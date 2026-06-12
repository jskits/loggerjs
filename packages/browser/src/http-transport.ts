import {
  applyPayloadTransforms,
  incrementLoggerMetaCounter,
  safeJsonCodec,
  toLevelValue,
  type Codec,
  type EncodedPayload,
  type LogEvent,
  type LoggerLevel,
  type PayloadTransform,
  type Transport,
  type TransportContext,
} from "@loggerjs/core";

export type BrowserHttpDropPolicy = "drop-oldest" | "drop-newest";

const DEFAULT_BEACON_MAX_BYTES = 60 * 1024;

const sleep = (delayMs: number) =>
  delayMs <= 0 ? Promise.resolve() : new Promise<void>((resolve) => setTimeout(resolve, delayMs));

export interface BrowserHttpOfflineEntry {
  id: string;
  url: string;
  method: "POST" | "PUT";
  headers: Record<string, string>;
  body: string | Uint8Array;
  credentials?: RequestCredentials;
  keepalive: boolean;
  createdAt: number;
}

export interface BrowserHttpOfflineQueue {
  enqueue: (entry: BrowserHttpOfflineEntry) => void | Promise<void>;
  replay: (send: (entry: BrowserHttpOfflineEntry) => Promise<void>) => void | Promise<void>;
}

export interface MemoryBrowserHttpOfflineQueueOptions {
  maxEntries?: number;
  dropPolicy?: BrowserHttpDropPolicy;
  onDrop?: (entry: BrowserHttpOfflineEntry, reason: string) => void;
}

export interface BrowserHttpTransportOptions {
  url: string;
  name?: string;
  method?: "POST" | "PUT";
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  keepalive?: boolean;
  codec?: Codec<string | Uint8Array>;
  minLevel?: LoggerLevel;
  maxBatchSize?: number;
  flushIntervalMs?: number;
  maxQueueSize?: number;
  dropPolicy?: BrowserHttpDropPolicy;
  useBeaconOnPageHide?: boolean;
  beaconMaxBytes?: number;
  offlineQueue?: BrowserHttpOfflineQueue;
  offlineReplayMaxRetries?: number;
  offlineReplayBaseDelayMs?: number;
  offlineReplayMaxDelayMs?: number;
  random?: () => number;
  fetchFn?: typeof fetch;
  transformPayload?: PayloadTransform | readonly PayloadTransform[];
  onDrop?: (event: LogEvent, reason: string) => void;
}

export function memoryBrowserHttpOfflineQueue(
  options: MemoryBrowserHttpOfflineQueueOptions = {},
): BrowserHttpOfflineQueue & { size: () => number } {
  const entries: BrowserHttpOfflineEntry[] = [];
  const maxEntries = options.maxEntries ?? 1000;
  const dropPolicy = options.dropPolicy ?? "drop-oldest";

  const drop = (entry: BrowserHttpOfflineEntry, reason: string) => {
    incrementLoggerMetaCounter("transport.offline.dropped");
    incrementLoggerMetaCounter(`transport.offline.dropped.${reason}`);
    options.onDrop?.(entry, reason);
  };

  return {
    enqueue(entry) {
      if (entries.length >= maxEntries) {
        if (dropPolicy === "drop-newest") {
          drop(entry, "queue-full");
          return;
        }
        const dropped = entries.shift();
        if (dropped) drop(dropped, "queue-full");
      }
      entries.push(entry);
    },
    async replay(send) {
      while (entries.length > 0) {
        const entry = entries[0];
        if (!entry) return;
        // oxlint-disable-next-line no-await-in-loop -- Replay must remove entries only after each send succeeds.
        await send(entry);
        entries.shift();
      }
    },
    size() {
      return entries.length;
    },
  };
}

function payloadToBody(payload: EncodedPayload): BodyInit {
  if (typeof payload === "string") return payload;
  return Uint8Array.from(payload);
}

function payloadByteLength(payload: EncodedPayload): number {
  if (typeof payload !== "string") return payload.byteLength;
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(payload).byteLength;
  return new Blob([payload]).size;
}

function payloadToBeaconBody(payload: EncodedPayload, contentType: string): BodyInit {
  return new Blob([typeof payload === "string" ? payload : Uint8Array.from(payload)], {
    type: contentType,
  });
}

interface BeaconChunk {
  events: LogEvent[];
  payload: string | Uint8Array;
}

function remainingEvents(chunks: BeaconChunk[], startIndex: number): LogEvent[] {
  const events: LogEvent[] = [];
  for (let index = startIndex; index < chunks.length; index++) {
    const chunk = chunks[index];
    if (chunk) events.push(...chunk.events);
  }
  return events;
}

export function browserHttpTransport(options: BrowserHttpTransportOptions): Transport {
  const codec = options.codec ?? safeJsonCodec();
  const queue: LogEvent[] = [];
  const maxBatchSize = options.maxBatchSize ?? 50;
  const flushIntervalMs = options.flushIntervalMs ?? 2000;
  const maxQueueSize = options.maxQueueSize ?? 1000;
  const dropPolicy = options.dropPolicy ?? "drop-oldest";
  const beaconMaxBytes = options.beaconMaxBytes ?? DEFAULT_BEACON_MAX_BYTES;
  const offlineQueue = options.offlineQueue;
  const offlineReplayMaxRetries = options.offlineReplayMaxRetries ?? 3;
  const offlineReplayBaseDelayMs = options.offlineReplayBaseDelayMs ?? 250;
  const offlineReplayMaxDelayMs = options.offlineReplayMaxDelayMs ?? 5000;
  const random = options.random ?? Math.random;
  const fetchFn = options.fetchFn ?? globalThis.fetch?.bind(globalThis);
  let offlineEntrySeq = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let flushing = false;
  let replayingOffline = false;
  let lastContext: TransportContext | undefined;

  const headers = (payloadHeaders?: Record<string, string>, contentType = codec.contentType) => ({
    "content-type": contentType,
    ...payloadHeaders,
    ...options.headers,
  });

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };

  const reportDrop = (event: LogEvent, reason: string) => {
    incrementLoggerMetaCounter("transport.dropped");
    incrementLoggerMetaCounter(`transport.dropped.${reason}`);
    options.onDrop?.(event, reason);
  };

  const reportInternalError = (error: unknown, operation: string) => {
    lastContext?.reportInternalError(error, {
      phase: "transport",
      transport: options.name ?? "browser-http",
      operation,
    });
  };

  const createBeaconChunks = (batch: LogEvent[]): BeaconChunk[] => {
    const chunks: BeaconChunk[] = [];
    let currentEvents: LogEvent[] = [];
    let currentPayload: string | Uint8Array | undefined;

    for (const event of batch) {
      const candidateEvents = [...currentEvents, event];
      const candidatePayload = codec.encode(candidateEvents);
      if (payloadByteLength(candidatePayload) <= beaconMaxBytes) {
        currentEvents = candidateEvents;
        currentPayload = candidatePayload;
        continue;
      }

      if (currentEvents.length > 0 && currentPayload) {
        chunks.push({ events: currentEvents, payload: currentPayload });
      }

      const singlePayload = codec.encode([event]);
      if (payloadByteLength(singlePayload) <= beaconMaxBytes) {
        currentEvents = [event];
        currentPayload = singlePayload;
      } else {
        currentEvents = [];
        currentPayload = undefined;
        reportDrop(event, "beacon-too-large");
      }
    }

    if (currentEvents.length > 0 && currentPayload) {
      chunks.push({ events: currentEvents, payload: currentPayload });
    }

    return chunks;
  };

  const sendBeaconBatch = (batch: LogEvent[]): { ok: boolean; remaining: LogEvent[] } => {
    if (typeof navigator === "undefined" || !navigator.sendBeacon) {
      return { ok: false, remaining: batch };
    }

    const chunks = createBeaconChunks(batch);
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index];
      if (!chunk) continue;
      const ok = navigator.sendBeacon(
        options.url,
        payloadToBeaconBody(chunk.payload, codec.contentType),
      );
      if (!ok) return { ok: false, remaining: remainingEvents(chunks, index) };
    }

    return { ok: true, remaining: [] };
  };

  const sendPayload = async (entry: BrowserHttpOfflineEntry) => {
    if (!fetchFn) throw new Error("fetch is not available for browserHttpTransport");
    const response = await fetchFn(entry.url, {
      method: entry.method,
      headers: entry.headers,
      body: payloadToBody(entry.body),
      credentials: entry.credentials,
      keepalive: entry.keepalive,
    });
    if (!response.ok) throw new Error(`browserHttpTransport failed with status ${response.status}`);
  };

  const encodeTransformedPayload = async (batch: LogEvent[]) => {
    const encoded = codec.encode(batch);
    return applyPayloadTransforms(
      encoded,
      {
        contentType: codec.contentType,
        events: batch,
        transport: options.name ?? "browser-http",
      },
      options.transformPayload,
    );
  };

  const createOfflineEntry = (
    payload: string | Uint8Array,
    payloadHeaders?: Record<string, string>,
    contentType?: string,
  ): BrowserHttpOfflineEntry => ({
    id: `${Date.now().toString(36)}-${(offlineEntrySeq++).toString(36)}`,
    url: options.url,
    method: options.method ?? "POST",
    headers: headers(payloadHeaders, contentType),
    body: payload,
    credentials: options.credentials,
    keepalive: options.keepalive ?? true,
    createdAt: Date.now(),
  });

  const enqueueOfflinePayload = async (
    payload: string | Uint8Array,
    payloadHeaders?: Record<string, string>,
    contentType?: string,
  ) => {
    if (!offlineQueue) return false;
    await offlineQueue.enqueue(createOfflineEntry(payload, payloadHeaders, contentType));
    incrementLoggerMetaCounter("transport.offline.queued");
    return true;
  };

  const sendFetchBatch = async (batch: LogEvent[]) => {
    if (batch.length === 0) return;
    const transformed = await encodeTransformedPayload(batch);
    if (offlineQueue && typeof navigator !== "undefined" && navigator.onLine === false) {
      await enqueueOfflinePayload(
        transformed.payload,
        transformed.headers,
        transformed.contentType,
      );
      return;
    }
    try {
      await sendPayload(
        createOfflineEntry(transformed.payload, transformed.headers, transformed.contentType),
      );
    } catch (error) {
      if (
        await enqueueOfflinePayload(
          transformed.payload,
          transformed.headers,
          transformed.contentType,
        )
      ) {
        return;
      }
      throw error;
    }
  };

  const replayRetryDelay = (attempt: number): number => {
    const cap = Math.min(offlineReplayMaxDelayMs, offlineReplayBaseDelayMs * 2 ** attempt);
    return cap <= 0 ? 0 : random() * cap;
  };

  const sendOfflineEntryWithRetry = async (entry: BrowserHttpOfflineEntry) => {
    for (let attempt = 0; ; attempt++) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- Retry attempts must run sequentially.
        await sendPayload(entry);
        incrementLoggerMetaCounter("transport.offline.replayed");
        return;
      } catch (error) {
        if (attempt >= offlineReplayMaxRetries) {
          incrementLoggerMetaCounter("transport.offline.replay.failed");
          throw error;
        }
        incrementLoggerMetaCounter("transport.offline.retry");
        // oxlint-disable-next-line no-await-in-loop -- Backoff must complete before the next retry.
        await sleep(replayRetryDelay(attempt));
      }
    }
  };

  const replayOfflineQueue = async () => {
    if (!offlineQueue || replayingOffline) return;
    replayingOffline = true;
    try {
      await offlineQueue.replay(sendOfflineEntryWithRetry);
    } finally {
      replayingOffline = false;
    }
  };

  const flush = async (preferBeacon = false) => {
    if (flushing || queue.length === 0) return;
    flushing = true;
    clearTimer();
    const batch = queue.splice(0, queue.length);
    let pendingBatch = batch;

    try {
      if (preferBeacon && !options.transformPayload) {
        const beaconResult = sendBeaconBatch(batch);
        if (beaconResult.ok || beaconResult.remaining.length === 0) return;
        pendingBatch = beaconResult.remaining;
      }

      await sendFetchBatch(pendingBatch);
      pendingBatch = [];
    } catch (error) {
      if (pendingBatch.length > 0) queue.unshift(...pendingBatch);
      throw error;
    } finally {
      flushing = false;
      if (queue.length > 0) schedule();
    }
  };

  const schedule = () => {
    if (timer || flushIntervalMs <= 0) return;
    timer = setTimeout(() => {
      void flush(false).catch((error: unknown) => reportInternalError(error, "flush"));
    }, flushIntervalMs);
  };

  const onPageHide = () => {
    void flush(true).catch((error: unknown) => reportInternalError(error, "pagehide-flush"));
  };
  const onVisibilityChange = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      void flush(true).catch((error: unknown) => reportInternalError(error, "visibility-flush"));
    }
  };
  const onOnline = () => {
    void replayOfflineQueue().catch((error: unknown) => reportInternalError(error, "replay"));
  };

  if (options.useBeaconOnPageHide ?? true) {
    globalThis.addEventListener?.("pagehide", onPageHide);
    globalThis.addEventListener?.("visibilitychange", onVisibilityChange);
  }
  if (offlineQueue) globalThis.addEventListener?.("online", onOnline);

  return {
    name: options.name ?? "browser-http",
    minLevel: options.minLevel,
    log(event, context) {
      if (options.minLevel !== undefined && event.level < toLevelValue(options.minLevel)) return;
      lastContext = context;
      if (queue.length >= maxQueueSize) {
        if (dropPolicy === "drop-newest") {
          reportDrop(event, "queue-full");
          return;
        }
        const dropped = queue.shift();
        if (dropped) reportDrop(dropped, "queue-full");
      }
      queue.push(event);
      if (queue.length >= maxBatchSize) {
        void flush(false).catch((error: unknown) => reportInternalError(error, "flush"));
      } else schedule();
    },
    flush() {
      return flush(false);
    },
    close() {
      globalThis.removeEventListener?.("pagehide", onPageHide);
      globalThis.removeEventListener?.("visibilitychange", onVisibilityChange);
      globalThis.removeEventListener?.("online", onOnline);
      return flush(true);
    },
  };
}
