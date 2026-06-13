export type LoggerDiagnosticStage = "encode" | "dispatch" | "transport" | "flush" | "worker";
export type LoggerDiagnosticPhase = "start" | "end" | "error";

export interface LoggerDiagnosticEvent {
  stage: LoggerDiagnosticStage;
  phase: LoggerDiagnosticPhase;
  logger?: string;
  transport?: string;
  codec?: string;
  operation?: string;
  level?: number;
  count?: number;
  durationMs?: number;
  error?: unknown;
  detail?: Record<string, unknown>;
}

export type LoggerDiagnosticSink = (event: LoggerDiagnosticEvent) => void;

let sink: LoggerDiagnosticSink | undefined;

export function setLoggerDiagnosticSink(
  next: LoggerDiagnosticSink | undefined,
): LoggerDiagnosticSink | undefined {
  const previous = sink;
  sink = next;
  return previous;
}

export function loggerDiagnosticsEnabled(): boolean {
  return sink !== undefined;
}

export function emitLoggerDiagnostic(event: LoggerDiagnosticEvent): void {
  sink?.(event);
}

export function loggerDiagnosticNow(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

export function runLoggerDiagnostic<T>(
  event: Omit<LoggerDiagnosticEvent, "phase" | "durationMs" | "error">,
  run: () => T,
): T {
  if (!sink) return run();
  const start = loggerDiagnosticNow();
  sink({ ...event, phase: "start" });
  try {
    const result = run();
    sink({ ...event, phase: "end", durationMs: loggerDiagnosticNow() - start });
    return result;
  } catch (error) {
    sink({ ...event, phase: "error", durationMs: loggerDiagnosticNow() - start, error });
    throw error;
  }
}
