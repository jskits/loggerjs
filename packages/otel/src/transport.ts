import { batchTransport, type BatchTransportOptions, type LoggerLevel, type Transport } from "@loggerjs/core";
import { otlpJsonCodec, type OtlpResourceOptions } from "./otlp-json";

export interface OtlpHttpTransportOptions extends BatchTransportOptions, OtlpResourceOptions {
  url: string;
  name?: string;
  headers?: Record<string, string>;
  minLevel?: LoggerLevel;
  fetchFn?: typeof fetch;
}

export function otlpHttpTransport(options: OtlpHttpTransportOptions): Transport {
  const codec = otlpJsonCodec(options);
  const fetchFn = options.fetchFn ?? globalThis.fetch?.bind(globalThis);
  const inner: Transport = {
    name: options.name ?? "otlp-http-inner",
    minLevel: options.minLevel,
    async logBatch(events) {
      if (!fetchFn) throw new Error("fetch is not available. Use Node.js 18+ or pass fetchFn.");
      await fetchFn(options.url, {
        method: "POST",
        headers: {
          "content-type": codec.contentType,
          ...(options.headers ?? {})
        },
        body: codec.encode(events)
      });
    }
  };

  return batchTransport(inner, {
    name: options.name ?? "otlp-http",
    maxBatchSize: options.maxBatchSize,
    flushIntervalMs: options.flushIntervalMs,
    maxQueueSize: options.maxQueueSize,
    dropPolicy: options.dropPolicy,
    onDrop: options.onDrop
  });
}
