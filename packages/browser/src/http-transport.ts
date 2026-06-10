import {
  incrementLoggerMetaCounter,
  safeJsonCodec,
  toLevelValue,
  type Codec,
  type LogEvent,
  type LoggerLevel,
  type Transport,
} from "@loggerjs/core";

export type BrowserHttpDropPolicy = "drop-oldest" | "drop-newest";

const DEFAULT_BEACON_MAX_BYTES = 60 * 1024;

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
  fetchFn?: typeof fetch;
  onDrop?: (event: LogEvent, reason: string) => void;
}

function payloadToBody(payload: string | Uint8Array): BodyInit {
  if (typeof payload === "string") return payload;
  return Uint8Array.from(payload);
}

function payloadByteLength(payload: string | Uint8Array): number {
  if (typeof payload !== "string") return payload.byteLength;
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(payload).byteLength;
  return new Blob([payload]).size;
}

function payloadToBeaconBody(payload: string | Uint8Array, contentType: string): BodyInit {
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
  const fetchFn = options.fetchFn ?? globalThis.fetch?.bind(globalThis);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let flushing = false;

  const headers = () => ({
    "content-type": codec.contentType,
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

  const sendFetchBatch = async (batch: LogEvent[]) => {
    if (batch.length === 0) return;
    const payload = codec.encode(batch);
    if (!fetchFn) throw new Error("fetch is not available for browserHttpTransport");
    await fetchFn(options.url, {
      method: options.method ?? "POST",
      headers: headers(),
      body: payloadToBody(payload),
      credentials: options.credentials,
      keepalive: options.keepalive ?? true,
    });
  };

  const flush = async (preferBeacon = false) => {
    if (flushing || queue.length === 0) return;
    flushing = true;
    clearTimer();
    const batch = queue.splice(0, queue.length);

    try {
      let fetchBatch = batch;
      if (preferBeacon) {
        const beaconResult = sendBeaconBatch(batch);
        if (beaconResult.ok || beaconResult.remaining.length === 0) return;
        fetchBatch = beaconResult.remaining;
      }

      await sendFetchBatch(fetchBatch);
    } finally {
      flushing = false;
      if (queue.length > 0) schedule();
    }
  };

  const schedule = () => {
    if (timer || flushIntervalMs <= 0) return;
    timer = setTimeout(() => {
      void flush(false);
    }, flushIntervalMs);
  };

  const onPageHide = () => {
    void flush(true);
  };
  const onVisibilityChange = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") void flush(true);
  };

  if (options.useBeaconOnPageHide ?? true) {
    globalThis.addEventListener?.("pagehide", onPageHide);
    globalThis.addEventListener?.("visibilitychange", onVisibilityChange);
  }

  return {
    name: options.name ?? "browser-http",
    minLevel: options.minLevel,
    log(event) {
      if (options.minLevel !== undefined && event.level < toLevelValue(options.minLevel)) return;
      if (queue.length >= maxQueueSize) {
        if (dropPolicy === "drop-newest") {
          reportDrop(event, "queue-full");
          return;
        }
        const dropped = queue.shift();
        if (dropped) reportDrop(dropped, "queue-full");
      }
      queue.push(event);
      if (queue.length >= maxBatchSize) void flush(false);
      else schedule();
    },
    flush() {
      return flush(false);
    },
    close() {
      globalThis.removeEventListener?.("pagehide", onPageHide);
      globalThis.removeEventListener?.("visibilitychange", onVisibilityChange);
      return flush(true);
    },
  };
}
