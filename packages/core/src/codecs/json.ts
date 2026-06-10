import type { Codec, LogEvent } from "../types";
import { safeJsonStringify, type SafeStringifyOptions } from "../utils/safe-stringify";

export function jsonCodec(): Codec<string> {
  return {
    name: "json",
    contentType: "application/json",
    encode(input: LogEvent | LogEvent[]) {
      return JSON.stringify(input);
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
    encode(input: LogEvent | LogEvent[]) {
      return safeJsonStringify(input, options);
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
    encode(input: LogEvent | LogEvent[]) {
      const events = Array.isArray(input) ? input : [input];
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
