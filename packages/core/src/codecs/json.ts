import type { Codec, LogEvent } from "../types";
import { incrementLoggerMetaCounter } from "../meta";
import { normalizeCodecInput, type CodecInput } from "../record";
import { safeJsonStringify, type SafeStringifyOptions } from "../utils/safe-stringify";

export function jsonCodec(): Codec<string> {
  return {
    name: "json",
    contentType: "application/json",
    encode(input: CodecInput) {
      return JSON.stringify(normalizeCodecInput(input));
    },
    decode(payload: string) {
      return JSON.parse(payload) as LogEvent | LogEvent[];
    },
  };
}

export function safeJsonCodec(options: SafeStringifyOptions = {}): Codec<string> {
  return {
    name: "safe-json",
    contentType: "application/json",
    encode(input: CodecInput) {
      return safeJsonStringify(normalizeCodecInput(input), options);
    },
    decode(payload: string) {
      return JSON.parse(payload) as LogEvent | LogEvent[];
    },
  };
}

function hasSafeOptions(options: SafeStringifyOptions): boolean {
  return (
    options.maxDepth !== undefined ||
    options.maxArrayLength !== undefined ||
    options.maxObjectKeys !== undefined ||
    options.includeStack !== undefined ||
    options.stable !== undefined ||
    options.space !== undefined
  );
}

/**
 * Same fast-by-default contract as fastEventJsonCodec: without options each
 * line is encoded with native `JSON.stringify`, and a line that throws
 * (circular references, BigInt) is re-encoded with the safe stringifier so
 * logs are never lost. Setting any {@link SafeStringifyOptions} field opts the
 * whole codec into safe normalization (depth caps, truncation, Error
 * expansion) for every line.
 */
export function ndjsonCodec(options: SafeStringifyOptions = {}): Codec<string> {
  const safeMode = hasSafeOptions(options);
  const encodeLine = (event: LogEvent): string => {
    if (safeMode) return safeJsonStringify(event, options);
    try {
      return JSON.stringify(event);
    } catch {
      incrementLoggerMetaCounter("codec.fallback");
      incrementLoggerMetaCounter("codec.fallback.ndjson");
      return safeJsonStringify(event, options);
    }
  };
  return {
    name: "ndjson",
    contentType: "application/x-ndjson",
    encode(input: CodecInput) {
      const normalized = normalizeCodecInput(input);
      if (!Array.isArray(normalized)) return `${encodeLine(normalized)}\n`;
      let output = "";
      for (const event of normalized) output += `${encodeLine(event)}\n`;
      return output;
    },
    decode(payload: string) {
      return payload
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as LogEvent);
    },
  };
}
