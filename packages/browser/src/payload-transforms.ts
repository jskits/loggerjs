import { type PayloadTransform, type PayloadTransformContext } from "@loggerjs/core";
import { encodedPayloadToUint8Array } from "@loggerjs/core/payload-transforms";

export type BrowserCompressionFormat = "gzip" | "deflate";

export interface BrowserCompressionPayloadTransformOptions {
  format?: BrowserCompressionFormat;
  headers?: Record<string, string>;
  compress?: (
    payload: Uint8Array,
    context: PayloadTransformContext & { format: BrowserCompressionFormat },
  ) => Uint8Array | Promise<Uint8Array>;
  streamFactory?: (format: BrowserCompressionFormat) => CompressionStream;
}

async function compressWithStream(
  payload: Uint8Array,
  format: BrowserCompressionFormat,
  streamFactory?: (format: BrowserCompressionFormat) => CompressionStream,
): Promise<Uint8Array> {
  const createStream =
    streamFactory ??
    ((nextFormat: BrowserCompressionFormat) => {
      if (typeof CompressionStream === "undefined") {
        throw new Error("CompressionStream is not available in this browser");
      }
      return new CompressionStream(nextFormat);
    });
  const stream = createStream(format);
  const writer = stream.writable.getWriter();
  await writer.write(Uint8Array.from(payload) as BufferSource);
  await writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

export function browserCompressionPayloadTransform(
  options: BrowserCompressionPayloadTransformOptions = {},
): PayloadTransform {
  const format = options.format ?? "gzip";
  return async (payload, context) => ({
    payload: await (options.compress
      ? options.compress(encodedPayloadToUint8Array(payload), { ...context, format })
      : compressWithStream(encodedPayloadToUint8Array(payload), format, options.streamFactory)),
    headers: {
      "content-encoding": format,
      ...options.headers,
    },
  });
}
