export type LoggerMetaStats = Record<string, number>;

const counters = new Map<string, number>();
const gauges = new Map<string, number>();
const originalConsoleKey = "__LOGGERJS_ORIGINAL_CONSOLE__";

export function incrementLoggerMetaCounter(name: string, amount = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + amount);
}

export function setLoggerMetaGauge(name: string, value: number): void {
  gauges.set(name, value);
}

export function getLoggerMetaStats(): LoggerMetaStats {
  return Object.fromEntries(counters);
}

export function getLoggerMetaGauges(): LoggerMetaStats {
  return Object.fromEntries(gauges);
}

export interface LoggerSelfMetrics {
  counters: LoggerMetaStats;
  gauges: LoggerMetaStats;
}

export function getLoggerSelfMetrics(): LoggerSelfMetrics {
  return {
    counters: getLoggerMetaStats(),
    gauges: getLoggerMetaGauges(),
  };
}

export function resetLoggerMetaStats(): void {
  counters.clear();
  gauges.clear();
}

function counterForDetail(detail: Record<string, unknown> | undefined): string {
  const phase = detail?.phase;
  if (phase === "middleware") return "middleware.errors";
  if (phase === "processor") return "processor.errors";
  if (phase === "transport") return "transport.errors";
  if (phase === "integration-setup") return "integration.errors";
  if (phase === "dispose") return "dispose.errors";
  return "internal.errors";
}

function getConsoleError(): (...args: unknown[]) => void {
  const registry = (globalThis as unknown as Record<string, unknown>)[originalConsoleKey] as
    | { error?: (...args: unknown[]) => void }
    | undefined;
  return registry?.error ?? console.error.bind(console);
}

export function reportLoggerMetaError(
  error: unknown,
  detail: Record<string, unknown> | undefined,
  handler: ((error: unknown, detail?: Record<string, unknown>) => void) | undefined,
): void {
  incrementLoggerMetaCounter(counterForDetail(detail));

  if (handler) {
    try {
      handler(error, detail);
      return;
    } catch {
      incrementLoggerMetaCounter("internal.handler_errors");
    }
  }

  try {
    getConsoleError()("[loggerjs internal error]", error, detail ?? {});
  } catch {
    incrementLoggerMetaCounter("internal.console_errors");
  }
}
