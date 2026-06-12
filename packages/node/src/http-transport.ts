import {
  applyPayloadTransforms,
  batchTransport,
  safeJsonCodec,
  type BatchTransportOptions,
  type Codec,
  type EncodedPayload,
  type LogEvent,
  type LoggerLevel,
  type PayloadTransform,
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
  transformPayload?: PayloadTransform | readonly PayloadTransform[];
}

function payloadToBody(payload: EncodedPayload): BodyInit {
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
      const encoded = codec.encode(events);
      const transformed = await applyPayloadTransforms(
        encoded,
        {
          contentType: codec.contentType,
          events,
          transport: options.name ?? "node-http",
        },
        options.transformPayload,
      );
      const response = await fetchFn(options.url, {
        method: options.method ?? "POST",
        headers: {
          "content-type": transformed.contentType,
          ...transformed.headers,
          ...options.headers,
        },
        body: payloadToBody(transformed.payload),
      });
      if (!response.ok) throw new Error(`nodeHttpTransport failed with status ${response.status}`);
    },
  };
  return batchTransport(inner, {
    name: options.name ?? "node-http",
    maxRecords: options.maxRecords,
    maxBatchSize: options.maxBatchSize,
    maxBytes: options.maxBytes,
    maxWaitMs: options.maxWaitMs,
    flushIntervalMs: options.flushIntervalMs,
    concurrency: options.concurrency,
    maxQueueSize: options.maxQueueSize,
    dropPolicy: options.dropPolicy,
    estimateEventBytes: options.estimateEventBytes,
    maxRetries: options.maxRetries,
    retryBaseDelayMs: options.retryBaseDelayMs,
    retryMaxDelayMs: options.retryMaxDelayMs,
    random: options.random,
    circuitBreakerFailureThreshold: options.circuitBreakerFailureThreshold,
    circuitBreakerResetMs: options.circuitBreakerResetMs,
    onDrop: options.onDrop,
  });
}
