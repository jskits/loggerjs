import {
  batchTransport,
  safeJsonCodec,
  type BatchTransportOptions,
  type Codec,
  type LogEvent,
  type LoggerLevel,
  type Transport,
} from "@loggerjs/core";

export interface NodeHttpTransportOptions extends BatchTransportOptions {
  url: string;
  name?: string;
  method?: "POST" | "PUT";
  headers?: Record<string, string>;
  codec?: Codec<string | Uint8Array>;
  minLevel?: LoggerLevel;
  fetchFn?: typeof fetch;
}

function payloadToBody(payload: string | Uint8Array): BodyInit {
  if (typeof payload === "string") return payload;
  return Uint8Array.from(payload);
}

export function nodeHttpTransport(options: NodeHttpTransportOptions): Transport {
  const codec = options.codec ?? safeJsonCodec();
  const fetchFn = options.fetchFn ?? globalThis.fetch?.bind(globalThis);
  const inner: Transport = {
    name: options.name ?? "node-http-inner",
    minLevel: options.minLevel,
    async logBatch(events: LogEvent[]) {
      if (!fetchFn) throw new Error("fetch is not available. Use Node.js 18+ or pass fetchFn.");
      await fetchFn(options.url, {
        method: options.method ?? "POST",
        headers: {
          "content-type": codec.contentType,
          ...options.headers,
        },
        body: payloadToBody(codec.encode(events)),
      });
    },
  };
  return batchTransport(inner, {
    name: options.name ?? "node-http",
    maxBatchSize: options.maxBatchSize,
    flushIntervalMs: options.flushIntervalMs,
    maxQueueSize: options.maxQueueSize,
    dropPolicy: options.dropPolicy,
    onDrop: options.onDrop,
  });
}
