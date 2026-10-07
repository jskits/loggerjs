import { diagnosticSink, replaceDiagnosticSink } from "./diagnostics-sink";
import { runtimeNow } from "./host";

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

export function setLoggerDiagnosticSink(
  next: LoggerDiagnosticSink | undefined,
): LoggerDiagnosticSink | undefined {
  return replaceDiagnosticSink(next);
}

export function loggerDiagnosticsEnabled(stage?: LoggerDiagnosticStage): boolean {
  const sink = diagnosticSink;
  if (!sink) return false;
  if (stage === undefined) return true;
  return sink.enabled?.(stage) ?? true;
}

export function emitLoggerDiagnostic(event: LoggerDiagnosticEvent): void {
  const sink = diagnosticSink;
  if (!sink || sink.enabled?.(event.stage) === false) return;
  sink(event);
}

export function loggerDiagnosticNow(): number {
  return runtimeNow();
}

export function runLoggerDiagnostic<T>(
  event: Omit<LoggerDiagnosticEvent, "phase" | "durationMs" | "error">,
  run: () => T,
): T {
  if (diagnosticSink === undefined || !loggerDiagnosticsEnabled(event.stage)) return run();
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
