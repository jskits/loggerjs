import { reportLoggerMetaError } from "./meta";
import type { LogRecord, Middleware, MiddlewareContext } from "./types";

export type MiddlewareProcess = Middleware["process"];

export function createMiddleware(name: string, process: MiddlewareProcess): Middleware {
  return { name, process };
}

export function runMiddleware(
  record: LogRecord,
  middleware: readonly Middleware[],
  context: MiddlewareContext,
): LogRecord | null {
  let current: LogRecord | null = record;

  for (const item of middleware) {
    if (current === null) return null;
    try {
      current = item.process(current, context);
    } catch (error) {
      reportLoggerMetaError(
        error,
        { phase: "middleware", middleware: item.name },
        context.reportInternalError,
      );
    }
  }

  return current;
}
