import { safeJsonCodec, toLevelValue, type Codec, type LogEvent, type LoggerLevel, type Transport } from "@loggerjs/core";

export type BrowserHttpDropPolicy = "drop-oldest" | "drop-newest";

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
  fetchFn?: typeof fetch;
  onDrop?: (event: LogEvent, reason: string) => void;
}

function payloadToBody(payload: string | Uint8Array): BodyInit {
  if (typeof payload === "string") return payload;
  return payload;
}

export function browserHttpTransport(options: BrowserHttpTransportOptions): Transport {
  const codec = options.codec ?? safeJsonCodec();
  const queue: LogEvent[] = [];
  const maxBatchSize = options.maxBatchSize ?? 50;
  const flushIntervalMs = options.flushIntervalMs ?? 2000;
  const maxQueueSize = options.maxQueueSize ?? 1000;
  const dropPolicy = options.dropPolicy ?? "drop-oldest";
  const fetchFn = options.fetchFn ?? globalThis.fetch?.bind(globalThis);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let flushing = false;

  const headers = () => ({
    "content-type": codec.contentType,
    ...(options.headers ?? {})
  });

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };

  const flush = async (preferBeacon = false) => {
    if (flushing || queue.length === 0) return;
    flushing = true;
    clearTimer();
    const batch = queue.splice(0, queue.length);
    const payload = codec.encode(batch);

    try {
      if (preferBeacon && typeof navigator !== "undefined" && navigator.sendBeacon && typeof payload === "string") {
        const blob = new Blob([payload], { type: codec.contentType });
        const ok = navigator.sendBeacon(options.url, blob);
        if (ok) return;
      }

      if (!fetchFn) throw new Error("fetch is not available for browserHttpTransport");
      await fetchFn(options.url, {
        method: options.method ?? "POST",
        headers: headers(),
        body: payloadToBody(payload),
        credentials: options.credentials,
        keepalive: options.keepalive ?? true
      });
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

  if (options.useBeaconOnPageHide ?? true) {
    globalThis.addEventListener?.("pagehide", onPageHide);
    globalThis.addEventListener?.("visibilitychange", () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") void flush(true);
    });
  }

  return {
    name: options.name ?? "browser-http",
    minLevel: options.minLevel,
    log(event) {
      if (options.minLevel !== undefined && event.level < toLevelValue(options.minLevel)) return;
      if (queue.length >= maxQueueSize) {
        if (dropPolicy === "drop-newest") {
          options.onDrop?.(event, "queue-full");
          return;
        }
        const dropped = queue.shift();
        if (dropped) options.onDrop?.(dropped, "queue-full");
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
      return flush(true);
    }
  };
}
