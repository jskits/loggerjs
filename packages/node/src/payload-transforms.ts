import {
  brotliCompressSync,
  deflateSync,
  gzipSync,
  type BrotliOptions,
  type ZlibOptions,
} from "node:zlib";
import {
  encodedPayloadToUint8Array,
  type EncodedPayload,
  type PayloadTransform,
} from "@loggerjs/core";

export type NodeCompressionFormat = "gzip" | "brotli" | "deflate";

export interface NodeCompressionPayloadTransformOptions {
  format?: NodeCompressionFormat;
  gzipOptions?: ZlibOptions;
  brotliOptions?: BrotliOptions;
  deflateOptions?: ZlibOptions;
  headers?: Record<string, string>;
}

const contentEncodingByFormat: Record<NodeCompressionFormat, string> = {
  gzip: "gzip",
  brotli: "br",
  deflate: "deflate",
};

function compressPayload(
  payload: EncodedPayload,
  format: NodeCompressionFormat,
  options: NodeCompressionPayloadTransformOptions,
): Uint8Array {
  const input = encodedPayloadToUint8Array(payload);
  if (format === "brotli") return Uint8Array.from(brotliCompressSync(input, options.brotliOptions));
  if (format === "deflate") return Uint8Array.from(deflateSync(input, options.deflateOptions));
  return Uint8Array.from(gzipSync(input, options.gzipOptions));
}

export function nodeCompressionPayloadTransform(
  options: NodeCompressionPayloadTransformOptions = {},
): PayloadTransform {
  const format = options.format ?? "gzip";
  return (payload) => ({
    payload: compressPayload(payload, format, options),
    headers: {
      "content-encoding": contentEncodingByFormat[format],
      ...options.headers,
    },
  });
}
