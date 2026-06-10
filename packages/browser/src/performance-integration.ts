import type { Integration, IntegrationSetupContext, LoggerLevel } from "@loggerjs/core";

export type BrowserPerformanceEntryType =
  | "element"
  | "event"
  | "longtask"
  | "mark"
  | "measure"
  | "navigation"
  | "paint"
  | "resource"
  | string;

export interface BrowserPerformanceEntryPayload {
  name: string;
  entryType: string;
  startTime: number;
  duration: number;
  initiatorType?: string;
  nextHopProtocol?: string;
  renderBlockingStatus?: string;
  responseStatus?: number;
  transferSize?: number;
  encodedBodySize?: number;
  decodedBodySize?: number;
  workerStart?: number;
  redirectStart?: number;
  redirectEnd?: number;
  fetchStart?: number;
  domainLookupStart?: number;
  domainLookupEnd?: number;
  connectStart?: number;
  connectEnd?: number;
  requestStart?: number;
  responseStart?: number;
  responseEnd?: number;
  detail?: unknown;
}

export interface CapturePerformanceOptions {
  entryTypes?: readonly BrowserPerformanceEntryType[];
  level?: LoggerLevel | ((entry: BrowserPerformanceEntryPayload) => LoggerLevel);
  buffered?: boolean;
  emitExisting?: boolean;
  maxEntries?: number;
  minDurationMs?: number | Partial<Record<string, number>>;
  sampleRate?: number;
  random?: () => number;
  captureDetail?: boolean;
  sanitizeName?: (name: string, entryType: string) => string;
  ignore?: (entry: BrowserPerformanceEntryPayload) => boolean;
  PerformanceObserver?: typeof PerformanceObserver;
  performance?: Pick<Performance, "getEntriesByType">;
}

type PerformanceEntryLike = PerformanceEntry & Record<string, unknown>;

const defaultEntryTypes: readonly BrowserPerformanceEntryType[] = [
  "navigation",
  "resource",
  "longtask",
  "measure",
  "mark",
];

const numberFields = [
  "transferSize",
  "encodedBodySize",
  "decodedBodySize",
  "workerStart",
  "redirectStart",
  "redirectEnd",
  "fetchStart",
  "domainLookupStart",
  "domainLookupEnd",
  "connectStart",
  "connectEnd",
  "requestStart",
  "responseStart",
  "responseEnd",
] as const;

function supportsEntryType(
  Observer: typeof PerformanceObserver | undefined,
  type: string,
): boolean {
  const supported = Observer?.supportedEntryTypes;
  return !supported || supported.includes(type);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

export function normalizeBrowserPerformanceEntry(
  entry: PerformanceEntry,
  options: Pick<CapturePerformanceOptions, "captureDetail" | "sanitizeName"> = {},
): BrowserPerformanceEntryPayload {
  const raw = entry as PerformanceEntryLike;
  const payload: BrowserPerformanceEntryPayload = {
    name: options.sanitizeName ? options.sanitizeName(entry.name, entry.entryType) : entry.name,
    entryType: entry.entryType,
    startTime: entry.startTime,
    duration: entry.duration,
  };

  for (const field of numberFields) {
    const value = finiteNumber(raw[field]);
    if (value !== undefined) payload[field] = value;
  }

  const responseStatus = finiteNumber(raw.responseStatus);
  if (responseStatus !== undefined) payload.responseStatus = responseStatus;
  const initiatorType = stringValue(raw.initiatorType);
  if (initiatorType) payload.initiatorType = initiatorType;
  const nextHopProtocol = stringValue(raw.nextHopProtocol);
  if (nextHopProtocol) payload.nextHopProtocol = nextHopProtocol;
  const renderBlockingStatus = stringValue(raw.renderBlockingStatus);
  if (renderBlockingStatus) payload.renderBlockingStatus = renderBlockingStatus;
  if (options.captureDetail && raw.detail !== undefined) payload.detail = raw.detail;

  return payload;
}

function minDurationFor(
  value: CapturePerformanceOptions["minDurationMs"],
  entryType: string,
): number {
  if (typeof value === "number") return value;
  return value?.[entryType] ?? 0;
}

function levelFor(
  value: CapturePerformanceOptions["level"],
  entry: BrowserPerformanceEntryPayload,
): LoggerLevel {
  if (typeof value === "function") return value(entry);
  if (value) return value;
  return entry.entryType === "longtask" ? "warn" : "info";
}

function entryKey(entry: BrowserPerformanceEntryPayload): string {
  return `${entry.entryType}:${entry.name}:${entry.startTime}:${entry.duration}`;
}

export function capturePerformanceIntegration(
  options: CapturePerformanceOptions = {},
): Integration {
  const entryTypes = options.entryTypes ?? defaultEntryTypes;
  const buffered = options.buffered ?? true;
  const emitExisting = options.emitExisting ?? true;
  const maxEntries = Math.max(0, Math.floor(options.maxEntries ?? 200));
  const sampleRate = options.sampleRate ?? 1;
  const random = options.random ?? Math.random;

  return {
    name: "capture-performance",
    setup(api: IntegrationSetupContext) {
      const Observer = options.PerformanceObserver ?? globalThis.PerformanceObserver;
      const perf = options.performance ?? globalThis.performance;
      const seen = new Set<string>();
      const disposers: Array<() => void> = [];
      let emitted = 0;
      let disposed = false;

      const capture = api.guard((entry: PerformanceEntry) => {
        if (disposed || emitted >= maxEntries) return;
        const payload = normalizeBrowserPerformanceEntry(entry, options);
        if (payload.duration < minDurationFor(options.minDurationMs, payload.entryType)) return;
        if (sampleRate < 1 && random() >= sampleRate) return;
        if (options.ignore?.(payload)) return;
        const key = entryKey(payload);
        if (seen.has(key)) return;
        seen.add(key);
        emitted += 1;
        api.capture({
          level: levelFor(options.level, payload),
          message: `Performance ${payload.entryType} ${payload.name}`,
          props: { performance: payload },
        });
      });

      const emitExistingEntries = (type: string) => {
        if (!emitExisting || !perf) return;
        try {
          for (const entry of perf.getEntriesByType(type)) capture(entry);
        } catch {
          // Some browser-like runtimes expose partial Performance APIs.
        }
      };

      for (const type of entryTypes) {
        emitExistingEntries(type);
        if (!Observer || !supportsEntryType(Observer, type)) continue;
        try {
          const observer = new Observer((list) => {
            for (const entry of list.getEntries()) capture(entry);
          });
          observer.observe({ type, buffered } as PerformanceObserverInit);
          disposers.push(() => observer.disconnect());
        } catch {
          // Unsupported observer types are skipped so other entry types still work.
        }
      }

      return () => {
        if (disposed) return;
        disposed = true;
        for (const dispose of disposers) dispose();
      };
    },
  };
}
