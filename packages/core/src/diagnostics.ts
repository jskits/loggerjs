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

export interface LoggerDiagnosticSink {
  (event: LoggerDiagnosticEvent): void;
  enabled?: (stage: LoggerDiagnosticStage) => boolean;
}

let sink: LoggerDiagnosticSink | undefined;

export function setLoggerDiagnosticSink(
  next: LoggerDiagnosticSink | undefined,
): LoggerDiagnosticSink | undefined {
  const previous = sink;
  sink = next;
  return previous;
}

export function loggerDiagnosticsEnabled(stage?: LoggerDiagnosticStage): boolean {
  if (!sink) return false;
  if (stage === undefined) return true;
  return sink.enabled?.(stage) ?? true;
}

export function emitLoggerDiagnostic(event: LoggerDiagnosticEvent): void {
  if (!sink || sink.enabled?.(event.stage) === false) return;
  sink(event);
}

export function loggerDiagnosticNow(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

export function runLoggerDiagnostic<T>(
  event: Omit<LoggerDiagnosticEvent, "phase" | "durationMs" | "error">,
  run: () => T,
): T {
  if (!loggerDiagnosticsEnabled(event.stage)) return run();
  const start = loggerDiagnosticNow();
  emitLoggerDiagnostic({ ...event, phase: "start" });
  try {
    const result = run();
    emitLoggerDiagnostic({ ...event, phase: "end", durationMs: loggerDiagnosticNow() - start });
    return result;
  } catch (error) {
    emitLoggerDiagnostic({
      ...event,
      phase: "error",
      durationMs: loggerDiagnosticNow() - start,
      error,
    });
    throw error;
  }
}
