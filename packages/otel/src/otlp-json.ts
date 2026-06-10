import {
  normalizeCodecInput,
  normalizeValue,
  type Codec,
  type CodecInput,
  type LogEvent,
} from "@loggerjs/core";
import { otelSeverityNumber, otelSeverityText } from "./severity";

export type OtlpAnyValue =
  | { stringValue: string }
  | { boolValue: boolean }
  | { intValue: string | number }
  | { doubleValue: number }
  | { arrayValue: { values: OtlpAnyValue[] } }
  | { kvlistValue: { values: Array<{ key: string; value: OtlpAnyValue }> } }
  | {};

export interface OtlpAttribute {
  key: string;
  value: OtlpAnyValue;
}

export interface OtlpLogRecord {
  timeUnixNano: string;
  observedTimeUnixNano?: string;
  severityNumber: number;
  severityText: string;
  body: OtlpAnyValue;
  attributes?: OtlpAttribute[];
  traceId?: string;
  spanId?: string;
  flags?: number;
}

export interface OtlpResourceOptions {
  resource?: Record<string, unknown>;
  scopeName?: string;
  scopeVersion?: string;
}

function toNanos(ms: number): string {
  return String(Math.floor(ms * 1_000_000));
}

function toAnyValue(value: unknown): OtlpAnyValue {
  const normalized = normalizeValue(value, {
    maxDepth: 8,
    maxArrayLength: 100,
    maxObjectKeys: 100,
  });
  if (normalized === undefined || normalized === null) return {};
  if (typeof normalized === "string") return { stringValue: normalized };
  if (typeof normalized === "boolean") return { boolValue: normalized };
  if (typeof normalized === "number") {
    if (Number.isInteger(normalized)) return { intValue: normalized };
    return { doubleValue: normalized };
  }
  if (typeof normalized === "bigint") return { intValue: normalized.toString() };
  if (Array.isArray(normalized)) return { arrayValue: { values: normalized.map(toAnyValue) } };
  if (typeof normalized === "object") {
    return {
      kvlistValue: {
        values: Object.entries(normalized as Record<string, unknown>).map(([key, child]) => ({
          key,
          value: toAnyValue(child),
        })),
      },
    };
  }
  return { stringValue: String(normalized) };
}

function attrs(record: Record<string, unknown>): OtlpAttribute[] {
  return Object.entries(record)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ({ key, value: toAnyValue(value) }));
}

function exceptionAttributes(error: LogEvent["error"]): Record<string, unknown> {
  if (!error) return {};
  return {
    "exception.type": error.name,
    "exception.message": error.message,
    "exception.stacktrace": error.stack,
    "exception.code": error.code,
    "exception.cause": error.cause,
  };
}

function flagsFromTrace(trace: LogEvent["trace"]): number | undefined {
  if (!trace) return undefined;
  if (typeof trace.traceFlags === "string") {
    const flags = Number.parseInt(trace.traceFlags, 16);
    if (Number.isFinite(flags)) return flags;
  }
  return trace.sampled ? 1 : undefined;
}

export function toOtlpLogRecord(event: LogEvent, observedTime = Date.now()): OtlpLogRecord {
  const attributes: Record<string, unknown> = {
    "loggerjs.event_id": event.id,
    "loggerjs.seq": event.seq,
    "loggerjs.logger": event.logger,
    "log.type": event.type,
    "log.tags": event.tags,
    "log.context": event.context,
    "log.data": event.data,
    "log.source": event.source,
    ...exceptionAttributes(event.error),
  };

  return {
    timeUnixNano: toNanos(event.time),
    observedTimeUnixNano: toNanos(observedTime),
    severityNumber: otelSeverityNumber[event.levelName],
    severityText: otelSeverityText(event.levelName),
    body: toAnyValue(event.message),
    attributes: attrs(attributes),
    traceId: event.trace?.traceId,
    spanId: event.trace?.spanId,
    flags: flagsFromTrace(event.trace),
  };
}

function groupedByCategory(events: LogEvent[]): Map<string, LogEvent[]> {
  const groups = new Map<string, LogEvent[]>();
  for (const event of events) {
    const category = event.logger || "app";
    const group = groups.get(category);
    if (group) group.push(event);
    else groups.set(category, [event]);
  }
  return groups;
}

export function toOtlpJson(events: LogEvent[], options: OtlpResourceOptions = {}) {
  const observedTime = Date.now();
  const scopeLogs = [...groupedByCategory(events)].map(([category, categoryEvents]) => ({
    scope: {
      name: options.scopeName ?? "loggerjs",
      version: options.scopeVersion,
      attributes: attrs({
        "loggerjs.category": category,
      }),
    },
    logRecords: categoryEvents.map((event) => toOtlpLogRecord(event, observedTime)),
  }));

  return {
    resourceLogs: [
      {
        resource: { attributes: attrs(options.resource ?? {}) },
        scopeLogs,
      },
    ],
  };
}

export function otlpJsonCodec(options: OtlpResourceOptions = {}): Codec<string> {
  return {
    name: "otlp-json",
    contentType: "application/json",
    encode(input: CodecInput) {
      const normalized = normalizeCodecInput(input);
      return JSON.stringify(
        toOtlpJson(Array.isArray(normalized) ? normalized : [normalized], options),
      );
    },
    decode(payload) {
      return JSON.parse(payload) as never;
    },
  };
}
