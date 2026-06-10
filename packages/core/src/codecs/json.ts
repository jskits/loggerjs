import type { Codec, LogEvent } from "../types";
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

export function ndjsonCodec(options: SafeStringifyOptions = {}): Codec<string> {
  return {
    name: "ndjson",
    contentType: "application/x-ndjson",
    encode(input: CodecInput) {
      const normalized = normalizeCodecInput(input);
      const events = Array.isArray(normalized) ? normalized : [normalized];
      return events.map((event) => safeJsonStringify(event, options)).join("\n") + "\n";
    },
    decode(payload: string) {
      return payload
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as LogEvent);
    },
  };
}
