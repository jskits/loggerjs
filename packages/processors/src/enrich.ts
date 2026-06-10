import type { LogEvent, Processor, ProcessorContext, Tags, TraceContext } from "@loggerjs/core";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeData(current: unknown, patch: unknown): unknown {
  if (patch === undefined) return current;
  if (isRecord(current) && isRecord(patch)) return { ...current, ...patch };
  return patch;
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
