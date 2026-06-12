import type { TraceContext } from "./types";

export type Baggage = Record<string, string>;

const traceParentPattern = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;

function validTraceId(traceId: string): boolean {
  return /^[0-9a-f]{32}$/i.test(traceId) && !/^0{32}$/i.test(traceId);
}

function validSpanId(spanId: string): boolean {
  return /^[0-9a-f]{16}$/i.test(spanId) && !/^0{16}$/i.test(spanId);
}

export function parseTraceparent(value: string | null | undefined): TraceContext | undefined {
  if (!value) return undefined;
  const match = traceParentPattern.exec(value.trim());
  if (!match) return undefined;
  const traceId = match[1]?.toLowerCase();
  const spanId = match[2]?.toLowerCase();
  const traceFlags = match[3]?.toLowerCase();
  if (!traceId || !spanId || !traceFlags) return undefined;
  if (!validTraceId(traceId) || !validSpanId(spanId)) return undefined;
  return {
    traceId,
    spanId,
    traceFlags,
    sampled: (Number.parseInt(traceFlags, 16) & 1) === 1,
  };
}

export function formatTraceparent(trace: TraceContext | undefined): string | undefined {
  if (!trace?.traceId || !trace.spanId) return undefined;
  const traceId = trace.traceId.toLowerCase();
  const spanId = trace.spanId.toLowerCase();
  if (!validTraceId(traceId) || !validSpanId(spanId)) return undefined;
  const traceFlags =
    trace.traceFlags ?? (trace.sampled === undefined ? "00" : trace.sampled ? "01" : "00");
  const normalizedFlags = traceFlags.toLowerCase().padStart(2, "0").slice(-2);
  if (!/^[0-9a-f]{2}$/.test(normalizedFlags)) return undefined;
  return `00-${traceId}-${spanId}-${normalizedFlags}`;
}

export function parseBaggage(value: string | null | undefined): Baggage | undefined {
  if (!value) return undefined;
  const baggage: Baggage = {};
  for (const item of value.split(",")) {
    const [rawKey, ...rawValue] = item.split("=");
    const key = rawKey?.trim();
    if (!key) continue;
    const encodedValue = rawValue.join("=").split(";")[0]?.trim();
    if (encodedValue === undefined) continue;
    try {
      baggage[key] = decodeURIComponent(encodedValue);
    } catch {
      baggage[key] = encodedValue;
    }
  }
  return Object.keys(baggage).length > 0 ? baggage : undefined;
}

export function formatBaggage(baggage: Baggage | undefined): string | undefined {
  if (!baggage) return undefined;
  const items: string[] = [];
  for (const [key, value] of Object.entries(baggage)) {
    if (!key || value === undefined) continue;
    items.push(`${key}=${encodeURIComponent(value)}`);
  }
  return items.length > 0 ? items.join(",") : undefined;
}

export interface TraceHeaders {
  traceparent?: string;
  baggage?: string;
}

export function traceContextFromHeaders(headers: TraceHeaders): TraceContext | undefined {
  const trace = parseTraceparent(headers.traceparent);
  if (!trace) return undefined;
  const baggage = parseBaggage(headers.baggage);
  return baggage ? { ...trace, baggage } : trace;
}

export function traceContextToHeaders(trace: TraceContext | undefined): TraceHeaders {
  const traceparent = formatTraceparent(trace);
  const baggage = formatBaggage(trace?.baggage as Baggage | undefined);
  return {
    traceparent,
    baggage,
  };
}
