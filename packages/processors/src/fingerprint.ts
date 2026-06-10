import type { LogEvent, Processor, ProcessorContext } from "@loggerjs/core";

export type FingerprintPart =
  | "logger"
  | "level"
  | "type"
  | "message"
  | "error.name"
  | "error.message"
  | "source.integration"
  | "source.runtime"
  | "stack.top"
  | ((event: LogEvent, context: ProcessorContext) => unknown);

export interface FingerprintOptions {
  parts?: readonly FingerprintPart[];
  hash?: (input: string) => string;
  target?: "tags" | "context";
  key?: string;
  separator?: string;
  prefix?: string;
}

const DEFAULT_PARTS: readonly FingerprintPart[] = [
  "logger",
  "type",
  "message",
  "error.name",
  "error.message",
  "source.integration",
];

function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function stackTop(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  const lines = stack.split("\n");
  return (lines[1] ?? lines[0])?.trim();
}

function partValue(part: FingerprintPart, event: LogEvent, context: ProcessorContext): unknown {
  if (typeof part === "function") return part(event, context);
  if (part === "logger") return event.logger;
  if (part === "level") return event.levelName;
  if (part === "type") return event.type;
  if (part === "message") return event.message;
  if (part === "error.name") return event.error?.name;
  if (part === "error.message") return event.error?.message;
  if (part === "source.integration") return event.source?.integration;
  if (part === "source.runtime") return event.source?.runtime;
  return stackTop(event.error?.stack);
}

function stringifyPart(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (value instanceof Error) return `${value.name}:${value.message}`;
  return String(value);
}

function writeFingerprint(
  event: LogEvent,
  target: "tags" | "context",
  key: string,
  fingerprint: string,
): LogEvent {
  if (target === "context") {
    return {
      ...event,
      context: { ...event.context, [key]: fingerprint },
    };
  }

  return {
    ...event,
    tags: { ...event.tags, [key]: fingerprint },
  };
}

export function fingerprintProcessor(options: FingerprintOptions = {}): Processor {
  const parts = options.parts ?? DEFAULT_PARTS;
  const hash = options.hash ?? fnv1a32;
  const target = options.target ?? "tags";
  const key = options.key ?? "fingerprint";
  const separator = options.separator ?? "\u001f";
  const prefix = options.prefix ?? "";

  return (event, context) => {
    const input = parts
      .map((part) => stringifyPart(partValue(part, event, context)))
      .join(separator);
    return writeFingerprint(event, target, key, `${prefix}${hash(input)}`);
  };
}
