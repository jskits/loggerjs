import {
  createBoundContext,
  createMiddleware,
  type LogEvent,
  type LogRecord,
  type Middleware,
  type MiddlewareContext,
  type Processor,
  type ProcessorContext,
  type Tags,
  type TraceContext,
} from "@loggerjs/core";

export interface EnrichPatch {
  message?: string;
  type?: string;
  tags?: Tags;
  data?: unknown;
  context?: Record<string, unknown>;
  trace?: TraceContext;
  source?: LogEvent["source"];
}

export type EnrichInput =
  | EnrichPatch
  | ((event: LogEvent, context: ProcessorContext) => EnrichPatch | false | void);

export interface EnrichRecordPatch {
  message?: string;
  type?: string;
  tags?: Tags;
  data?: unknown;
  context?: Record<string, unknown>;
  trace?: TraceContext;
  source?: string | LogEvent["source"];
}

export type EnrichMiddlewareInput =
  | EnrichRecordPatch
  | ((record: LogRecord, context: MiddlewareContext) => EnrichRecordPatch | false | void);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeData(current: unknown, patch: unknown): unknown {
  if (patch === undefined) return current;
  if (isRecord(current) && isRecord(patch)) return { ...current, ...patch };
  return patch;
}

function mergeRecordData(
  current: Record<string, unknown> | null,
  patch: unknown,
): Record<string, unknown> | null {
  if (patch === undefined) return current;
  if (isRecord(current) && isRecord(patch)) return { ...current, ...patch };
  if (isRecord(patch)) return patch;
  return { value: patch };
}

function sourceForRecord(source: EnrichRecordPatch["source"]): string | undefined {
  if (!source) return undefined;
  if (typeof source === "string") return source;
  return source.integration ?? source.runtime;
}

function applyPatch(event: LogEvent, patch: EnrichPatch): LogEvent {
  return {
    ...event,
    message: patch.message ?? event.message,
    type: patch.type ?? event.type,
    tags: patch.tags ? { ...event.tags, ...patch.tags } : event.tags,
    data: mergeData(event.data, patch.data),
    context: patch.context ? { ...event.context, ...patch.context } : event.context,
    trace: patch.trace ? { ...event.trace, ...patch.trace } : event.trace,
    source: patch.source ? { ...event.source, ...patch.source } : event.source,
  };
}

export function enrichProcessor(input: EnrichInput): Processor {
  return (event, context) => {
    const patch = typeof input === "function" ? input(event, context) : input;
    if (patch === false) return false;
    if (!patch) return event;
    return applyPatch(event, patch);
  };
}

function applyRecordPatch(record: LogRecord, patch: EnrichRecordPatch): LogRecord {
  if (patch.message !== undefined) {
    record.msg = patch.message;
    record.lazy = null;
  }
  if (patch.type !== undefined) record.type = patch.type;
  if (patch.tags) {
    record.tags = {
      ...record.tags,
      ...patch.tags,
    };
  }
  if (patch.data !== undefined) record.props = mergeRecordData(record.props, patch.data);
  if (patch.context) {
    record.ctx = createBoundContext({
      ...record.ctx,
      ...patch.context,
    });
  }
  if (patch.trace) {
    record.trace = {
      ...record.trace,
      ...patch.trace,
    };
  }
  const source = sourceForRecord(patch.source);
  if (source) record.source = source;
  return record;
}

export function enrichMiddleware(input: EnrichMiddlewareInput): Middleware {
  return createMiddleware("enrich", (record, context) => {
    const patch = typeof input === "function" ? input(record, context) : input;
    if (patch === false) return null;
    if (!patch) return record;
    return applyRecordPatch(record, patch);
  });
}
