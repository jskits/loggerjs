import type { LoggerDiagnosticSink } from "./diagnostics";

// Unlike the registry and context, the sink stays module-local: when nothing
// installs one, this binding is never assigned, so bundlers drop the
// instrumentation that Logger and the diagnostics helpers guard with a direct
// test of it. With shareAcrossCopies the configuring copy builds every
// registry logger, so its sink sees them; a sink installed through a
// different copy only misses diagnostics, never log events.
// oxlint-disable-next-line import/no-mutable-exports -- Read as a live binding so the guards fold.
export let diagnosticSink: LoggerDiagnosticSink | undefined;

export function replaceDiagnosticSink(
  next: LoggerDiagnosticSink | undefined,
): LoggerDiagnosticSink | undefined {
  const previous = diagnosticSink;
  diagnosticSink = next;
  return previous;
}
