import type { Codec, LogEvent } from "@loggerjs/core";
import { safeJsonStringify, type SafeStringifyOptions } from "@loggerjs/core";

export interface FastEventJsonCodecOptions extends SafeStringifyOptions {
  includeContext?: boolean;
  includeData?: boolean;
  includeError?: boolean;
  includeTrace?: boolean;
  includeSource?: boolean;
}

function appendField(parts: string[], name: string, value: unknown, options: SafeStringifyOptions) {
  if (value === undefined) return;
  parts.push(`,"${name}":${safeJsonStringify(value, options)}`);
}

function encodeEvent(event: LogEvent, options: FastEventJsonCodecOptions): string {
  const safeOptions: SafeStringifyOptions = options;
  const parts: string[] = [
    `{"id":${JSON.stringify(event.id)}`,
    `,"time":${event.time}`,
    `,"seq":${event.seq}`,
    `,"level":${event.level}`,
    `,"levelName":${JSON.stringify(event.levelName)}`,
    `,"logger":${JSON.stringify(event.logger)}`,
    `,"message":${JSON.stringify(event.message)}`
  ];
  appendField(parts, "type", event.type, safeOptions);
  appendField(parts, "tags", event.tags, safeOptions);
  if (options.includeData ?? true) appendField(parts, "data", event.data, safeOptions);
  if (options.includeError ?? true) appendField(parts, "error", event.error, safeOptions);
  if (options.includeContext ?? true) appendField(parts, "context", event.context, safeOptions);
  if (options.includeTrace ?? true) appendField(parts, "trace", event.trace, safeOptions);
  if (options.includeSource ?? true) appendField(parts, "source", event.source, safeOptions);
  parts.push("}");
  return parts.join("");
}

export function fastEventJsonCodec(options: FastEventJsonCodecOptions = {}): Codec<string> {
  return {
    name: "fast-event-json",
    contentType: "application/json",
    encode(input) {
      if (Array.isArray(input)) return `[${input.map((event) => encodeEvent(event, options)).join(",")}]`;
      return encodeEvent(input, options);
    },
    decode(payload) {
      return JSON.parse(payload) as LogEvent | LogEvent[];
    }
  };
}
