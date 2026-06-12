import { incrementLoggerMetaCounter } from "../meta";
import type { Codec, LogEvent, LogRecord } from "../types";

export interface MetricsCodecOptions<TPayload = string | Uint8Array> {
  name?: string;
  byteLength?: (payload: TPayload) => number;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

function defaultByteLength(payload: unknown): number {
  if (typeof payload === "string") return utf8ByteLength(payload);
  if (payload instanceof Uint8Array) return payload.byteLength;
  return 0;
}

export function metricsCodec<TPayload = string | Uint8Array>(
  codec: Codec<TPayload>,
  options: MetricsCodecOptions<TPayload> = {},
): Codec<TPayload> {
  const name = options.name ?? codec.name;
  const byteLength = options.byteLength ?? defaultByteLength;
  const wrapped: Codec<TPayload> = {
    name: `metrics(${codec.name})`,
    contentType: codec.contentType,
    encode(input: LogEvent | LogRecord | readonly (LogEvent | LogRecord)[], context) {
      try {
        const payload = codec.encode(input, context);
        const bytes = byteLength(payload);
        incrementLoggerMetaCounter("codec.encode");
        incrementLoggerMetaCounter(`codec.encode.${name}`);
        incrementLoggerMetaCounter("codec.encoded.bytes", bytes);
        incrementLoggerMetaCounter(`codec.encoded.bytes.${name}`, bytes);
        return payload;
      } catch (error) {
        incrementLoggerMetaCounter("codec.encode.errors");
        incrementLoggerMetaCounter(`codec.encode.errors.${name}`);
        throw error;
      }
    },
  };

  if (codec.decode) {
    wrapped.decode = (payload: TPayload) => {
      try {
        const decoded = codec.decode?.(payload) as LogEvent | LogEvent[];
        incrementLoggerMetaCounter("codec.decode");
        incrementLoggerMetaCounter(`codec.decode.${name}`);
        return decoded;
      } catch (error) {
        incrementLoggerMetaCounter("codec.decode.errors");
        incrementLoggerMetaCounter(`codec.decode.errors.${name}`);
        throw error;
      }
    };
  }

  return wrapped;
}
