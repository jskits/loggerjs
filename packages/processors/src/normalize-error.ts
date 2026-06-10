import type { Processor, SerializedError } from "@loggerjs/core";

export interface NormalizeErrorProcessorOptions {
  maxDepth?: number;
  maxStackLines?: number;
  includeEnumerableProperties?: boolean;
  includeAggregateErrors?: boolean;
  dataErrorKeys?: readonly string[];
}

export interface NormalizedError extends SerializedError {
  cause?: NormalizedError;
  errors?: NormalizedError[];
}

interface NormalizedOptions {
  maxDepth: number;
  maxStackLines: number;
  includeEnumerableProperties: boolean;
  includeAggregateErrors: boolean;
  dataErrorKeys: readonly string[];
}

function stackWithLimit(stack: unknown, maxStackLines: number): string | undefined {
  if (typeof stack !== "string" || maxStackLines <= 0) return undefined;
  return stack.split("\n").slice(0, maxStackLines).join("\n");
}

function errorMessage(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "message" in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(value);
}

function errorName(value: unknown): string | undefined {
  if (value && typeof value === "object" && "name" in value) {
    const name = (value as { name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  return value instanceof Error ? value.name : undefined;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function normalizeUnknownError(
  value: unknown,
  options: NormalizedOptions,
  depth: number,
  seen: WeakSet<object>,
): NormalizedError {
  if (depth > options.maxDepth) return { message: "[Max error depth]" };
  if (value === null || value === undefined) return { message: String(value) };
  if (typeof value !== "object") return { message: errorMessage(value) };

  if (seen.has(value)) return { message: "[Circular error]" };
  seen.add(value);

  const record = objectRecord(value);
  const out: NormalizedError = {
    name: errorName(value),
    message: errorMessage(value),
    stack: stackWithLimit(record?.stack, options.maxStackLines),
  };

  const code = record?.code;
  if (typeof code === "string" || typeof code === "number") out.code = code;

  if (record?.cause !== undefined) {
    out.cause = normalizeUnknownError(record.cause, options, depth + 1, seen);
  }

  if (options.includeAggregateErrors && Array.isArray(record?.errors)) {
    out.errors = record.errors.map((item) => normalizeUnknownError(item, options, depth + 1, seen));
  }

  if (options.includeEnumerableProperties && record) {
    for (const key of Object.keys(record)) {
      if (key in out || key === "errors" || key === "cause") continue;
      out[key] = record[key];
    }
  }

  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeDataErrors(
  data: unknown,
  options: NormalizedOptions,
  seen: WeakSet<object>,
): unknown {
  if (!isRecord(data) || options.dataErrorKeys.length === 0) return data;

  let next: Record<string, unknown> | undefined;
  for (const key of options.dataErrorKeys) {
    if (!(key in data) || data[key] === undefined || data[key] === null) continue;
    next ??= { ...data };
    next[key] = normalizeUnknownError(data[key], options, 0, seen);
  }
  return next ?? data;
}

export function normalizeErrorProcessor(options: NormalizeErrorProcessorOptions = {}): Processor {
  const normalized: NormalizedOptions = {
    maxDepth: Math.max(0, Math.floor(options.maxDepth ?? 5)),
    maxStackLines: Math.max(0, Math.floor(options.maxStackLines ?? 40)),
    includeEnumerableProperties: options.includeEnumerableProperties ?? true,
    includeAggregateErrors: options.includeAggregateErrors ?? true,
    dataErrorKeys: options.dataErrorKeys ?? [],
  };

  return (event) => {
    const seen = new WeakSet<object>();
    const error =
      event.error === undefined
        ? undefined
        : normalizeUnknownError(event.error, normalized, 0, seen);
    const data = normalizeDataErrors(event.data, normalized, seen);

    if (error === undefined && data === event.data) return event;
    return {
      ...event,
      error,
      data,
    };
  };
}
