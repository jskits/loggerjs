import type { Codec, LogEvent } from "../types";
import { runLoggerDiagnostic } from "../diagnostics";
import { enabledLevelNames } from "../levels";
import { incrementLoggerMetaCounter } from "../meta";
import { normalizeCodecInput, type CodecInput } from "../record";
import { safeJsonStringify, type SafeStringifyOptions } from "../utils/safe-stringify";

const levelNameSet = new Set<string>(enabledLevelNames);

function invalidLogEvent(path: string, expected: string): never {
  throw new TypeError(`Invalid LoggerJS log event payload at ${path}: expected ${expected}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string") invalidLogEvent(path, "string");
  return value;
}

function requireFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) invalidLogEvent(path, "finite number");
  return value;
}

function assertOptionalString(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== "string") invalidLogEvent(path, "string");
}

function assertOptionalObject(value: unknown, path: string): void {
  if (value !== undefined && !isRecord(value)) invalidLogEvent(path, "object");
}

function assertTags(value: unknown, path: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) invalidLogEvent(path, "object");
  for (const [key, item] of Object.entries(value)) {
    const type = typeof item;
    if (item !== null && type !== "string" && type !== "number" && type !== "boolean") {
      invalidLogEvent(`${path}.${key}`, "string, number, boolean, or null");
    }
    if (type === "number" && !Number.isFinite(item)) {
      invalidLogEvent(`${path}.${key}`, "finite number");
    }
  }
}

function assertSerializedError(value: unknown, path: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) invalidLogEvent(path, "object");
  requireString(value.message, `${path}.message`);
  assertOptionalString(value.name, `${path}.name`);
  assertOptionalString(value.stack, `${path}.stack`);
  if (
    value.code !== undefined &&
    typeof value.code !== "string" &&
    typeof value.code !== "number"
  ) {
    invalidLogEvent(`${path}.code`, "string or number");
  }
}

function validateLogEvent(value: unknown, path: string): LogEvent {
  if (!isRecord(value)) invalidLogEvent(path, "object");
  requireString(value.id, `${path}.id`);
  requireFiniteNumber(value.time, `${path}.time`);
  requireFiniteNumber(value.seq, `${path}.seq`);
  requireFiniteNumber(value.level, `${path}.level`);
  const levelName = requireString(value.levelName, `${path}.levelName`);
  if (!levelNameSet.has(levelName)) invalidLogEvent(`${path}.levelName`, "enabled log level name");
  requireString(value.logger, `${path}.logger`);
  requireString(value.message, `${path}.message`);
  assertOptionalString(value.type, `${path}.type`);
  assertTags(value.tags, `${path}.tags`);
  assertSerializedError(value.error, `${path}.error`);
  assertOptionalObject(value.context, `${path}.context`);
  assertOptionalObject(value.trace, `${path}.trace`);
  assertOptionalObject(value.source, `${path}.source`);
  return value as unknown as LogEvent;
}

function validateLogEventPayload(value: unknown, path = "payload"): LogEvent | LogEvent[] {
  if (!Array.isArray(value)) return validateLogEvent(value, path);
  return value.map((item, index) => validateLogEvent(item, `${path}[${index}]`));
}

export function jsonCodec(): Codec<string> {
  return {
    name: "json",
    contentType: "application/json",
    encode(input: CodecInput) {
      return runLoggerDiagnostic({ stage: "encode", codec: "json" }, () =>
        JSON.stringify(normalizeCodecInput(input)),
      );
    },
    decode(payload: string) {
      return validateLogEventPayload(JSON.parse(payload));
    },
  };
}

export function safeJsonCodec(options: SafeStringifyOptions = {}): Codec<string> {
  return {
    name: "safe-json",
    contentType: "application/json",
    encode(input: CodecInput) {
      return runLoggerDiagnostic({ stage: "encode", codec: "safe-json" }, () =>
        safeJsonStringify(normalizeCodecInput(input), options),
      );
    },
    decode(payload: string) {
      return validateLogEventPayload(JSON.parse(payload));
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
      return runLoggerDiagnostic({ stage: "encode", codec: "ndjson" }, () => {
        const normalized = normalizeCodecInput(input);
        if (!Array.isArray(normalized)) return `${encodeLine(normalized)}\n`;
        let output = "";
        for (const event of normalized) output += `${encodeLine(event)}\n`;
        return output;
      });
    },
    decode(payload: string) {
      return payload
        .split("\n")
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => line.length > 0)
        .map(({ line, index }) => validateLogEvent(JSON.parse(line), `payload line ${index + 1}`));
    },
  };
}
