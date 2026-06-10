import type { Integration, IntegrationSetupContext, LoggerLevel } from "@loggerjs/core";

export type WebVitalName = "CLS" | "FCP" | "INP" | "LCP" | "TTFB";
export type WebVitalRating = "good" | "needs-improvement" | "poor";

export interface WebVitalMetric {
  name: WebVitalName;
  value: number;
  delta: number;
  rating: WebVitalRating;
  id: string;
  final: boolean;
}

export interface CaptureWebVitalsOptions {
  metrics?: readonly WebVitalName[];
  level?: LoggerLevel;
  reportAllChanges?: boolean;
  flushOnHidden?: boolean;
  PerformanceObserver?: typeof PerformanceObserver;
  performance?: Pick<Performance, "getEntriesByName" | "getEntriesByType">;
  addEventListener?: typeof globalThis.addEventListener;
  removeEventListener?: typeof globalThis.removeEventListener;
}

type PerformanceEntryLike = PerformanceEntry & Record<string, unknown>;

const defaultMetrics: readonly WebVitalName[] = ["CLS", "FCP", "INP", "LCP", "TTFB"];

const thresholds: Record<WebVitalName, readonly [number, number]> = {
  CLS: [0.1, 0.25],
  FCP: [1800, 3000],
  INP: [200, 500],
  LCP: [2500, 4000],
  TTFB: [800, 1800],
};

function ratingFor(name: WebVitalName, value: number): WebVitalRating {
  const [good, needsImprovement] = thresholds[name];
  if (value <= good) return "good";
  if (value <= needsImprovement) return "needs-improvement";
  return "poor";
}

function metricId(name: WebVitalName): string {
  return `${name.toLowerCase()}-${Date.now().toString(36)}`;
}

function entryValue(entry: PerformanceEntryLike, field: string): number | undefined {
  const value = entry[field];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function hasMetric(metrics: readonly WebVitalName[], name: WebVitalName): boolean {
  return metrics.includes(name);
}

function supportsEntryType(
  Observer: typeof PerformanceObserver | undefined,
  type: string,
): boolean {
  const supported = Observer?.supportedEntryTypes;
  return !supported || supported.includes(type);
}

export function captureWebVitalsIntegration(options: CaptureWebVitalsOptions = {}): Integration {
  const metrics = options.metrics ?? defaultMetrics;
  const level = options.level ?? "info";
  const reportAllChanges = options.reportAllChanges ?? false;
  const flushOnHidden = options.flushOnHidden ?? true;

  return {
    name: "capture-web-vitals",
    setup(api: IntegrationSetupContext) {
      const Observer = options.PerformanceObserver ?? globalThis.PerformanceObserver;
      const perf = options.performance ?? globalThis.performance;
      const add = options.addEventListener ?? globalThis.addEventListener?.bind(globalThis);
      const remove =
        options.removeEventListener ?? globalThis.removeEventListener?.bind(globalThis);
      const disposers: Array<() => void> = [];
      const currentValues = new Map<WebVitalName, number>();
      const reportedValues = new Map<WebVitalName, number>();
      const emitted = new Set<string>();
      let disposed = false;

      const emit = (name: WebVitalName, value: number, final: boolean) => {
        if (!Number.isFinite(value)) return;
        const finalKey = `${name}:final`;
        if (final && emitted.has(finalKey)) return;
        const previous = reportedValues.get(name) ?? 0;
        currentValues.set(name, value);
        reportedValues.set(name, value);
        if (final) emitted.add(finalKey);
        const metric: WebVitalMetric = {
          name,
          value,
          delta: value - previous,
          rating: ratingFor(name, value),
          id: metricId(name),
          final,
        };
        api.capture({
          level,
          message: `Web vital ${metric.name} ${metric.value}`,
          props: { webVital: metric },
        });
      };

      const observe = (
        type: string,
        callback: (entry: PerformanceEntryLike) => void,
        init: PerformanceObserverInit = { type, buffered: true },
      ) => {
        if (!Observer || !supportsEntryType(Observer, type)) return;
        try {
          const observer = new Observer((list) => {
            for (const entry of list.getEntries()) callback(entry as PerformanceEntryLike);
          });
          observer.observe(init);
          disposers.push(() => observer.disconnect());
        } catch {
          // Unsupported observer types vary across browsers; missing vitals are simply skipped.
        }
      };

      if (hasMetric(metrics, "TTFB") && perf) {
        const navigation = perf.getEntriesByType("navigation")[0] as
          | PerformanceEntryLike
          | undefined;
        if (navigation) {
          const responseStart = entryValue(navigation, "responseStart");
          const startTime = entryValue(navigation, "startTime") ?? 0;
          if (responseStart !== undefined) emit("TTFB", responseStart - startTime, true);
        }
      }

      if (hasMetric(metrics, "FCP") && perf) {
        const existing = perf.getEntriesByName("first-contentful-paint")[0];
        if (existing) emit("FCP", existing.startTime, true);
        observe("paint", (entry) => {
          if (entry.name === "first-contentful-paint") emit("FCP", entry.startTime, true);
        });
      }

      if (hasMetric(metrics, "CLS")) {
        observe("layout-shift", (entry) => {
          if (entry.hadRecentInput === true) return;
          const value = entryValue(entry, "value") ?? 0;
          const next = (currentValues.get("CLS") ?? 0) + value;
          if (reportAllChanges) emit("CLS", next, false);
          else currentValues.set("CLS", next);
        });
      }

      if (hasMetric(metrics, "LCP")) {
        observe("largest-contentful-paint", (entry) => {
          currentValues.set("LCP", entry.startTime);
          if (reportAllChanges) emit("LCP", entry.startTime, false);
        });
      }

      if (hasMetric(metrics, "INP")) {
        observe(
          "event",
          (entry) => {
            const duration = entryValue(entry, "duration") ?? 0;
            if (duration <= (currentValues.get("INP") ?? 0)) return;
            currentValues.set("INP", duration);
            if (reportAllChanges) emit("INP", duration, false);
          },
          { type: "event", buffered: true, durationThreshold: 40 } as PerformanceObserverInit,
        );
      }

      const flushFinal = api.guard(() => {
        const cls = currentValues.get("CLS");
        if (cls !== undefined && cls > 0) emit("CLS", cls, true);
        const lcp = currentValues.get("LCP");
        if (lcp !== undefined) emit("LCP", lcp, true);
        const inp = currentValues.get("INP");
        if (inp !== undefined) emit("INP", inp, true);
      });

      if (flushOnHidden && add && remove) {
        const onPageHide = () => flushFinal();
        const onVisibilityChange = () => {
          if (typeof document !== "undefined" && document.visibilityState === "hidden")
            flushFinal();
        };
        add("pagehide", onPageHide);
        add("visibilitychange", onVisibilityChange);
        disposers.push(() => {
          remove("pagehide", onPageHide);
          remove("visibilitychange", onVisibilityChange);
        });
      }

      return () => {
        if (disposed) return;
        disposed = true;
        flushFinal();
        for (const dispose of disposers) dispose();
      };
    },
  };
}
