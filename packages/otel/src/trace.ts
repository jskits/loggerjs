import type { Processor, TraceContext } from "@loggerjs/core";

export interface OpenTelemetrySpanContextLike {
  traceId: string;
  spanId: string;
  traceFlags?: number;
}

export interface OpenTelemetrySpanLike {
  spanContext: () => OpenTelemetrySpanContextLike;
}

export interface OpenTelemetryApiLike {
  trace?: {
    getActiveSpan?: () => OpenTelemetrySpanLike | undefined;
  };
}

export interface OpenTelemetryTraceProcessorOptions {
  api?: OpenTelemetryApiLike;
}

function traceFlagsToHex(traceFlags: number | undefined): string | undefined {
  if (traceFlags === undefined) return undefined;
  return traceFlags.toString(16).padStart(2, "0");
}

function activeTraceContext(api: OpenTelemetryApiLike | undefined): TraceContext | undefined {
  const span = api?.trace?.getActiveSpan?.();
  if (!span) return undefined;
  const spanContext = span.spanContext();
  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    traceFlags: traceFlagsToHex(spanContext.traceFlags),
    sampled: spanContext.traceFlags === undefined ? undefined : (spanContext.traceFlags & 1) === 1,
  };
}

export function openTelemetryTraceProcessor(
  options: OpenTelemetryTraceProcessorOptions = {},
): Processor {
  return (event) => {
    const trace = activeTraceContext(options.api);
    if (!trace) return event;
    return {
      ...event,
      trace: {
        ...event.trace,
        ...trace,
      },
    };
  };
}
