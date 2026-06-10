import {
  toLevelValue,
  type LogEvent,
  type LoggerLevel,
  type SerializedError,
  type Transport,
} from "@loggerjs/core";

export type SentrySeverity = "debug" | "error" | "fatal" | "info" | "log" | "warning";

export interface SentryLoggerLike {
  trace?: (message: string, attributes?: Record<string, unknown>) => void;
  debug?: (message: string, attributes?: Record<string, unknown>) => void;
  info?: (message: string, attributes?: Record<string, unknown>) => void;
  warn?: (message: string, attributes?: Record<string, unknown>) => void;
  error?: (message: string, attributes?: Record<string, unknown>) => void;
  fatal?: (message: string, attributes?: Record<string, unknown>) => void;
}

export interface SentryLike {
  logger?: SentryLoggerLike;
  addBreadcrumb?: (breadcrumb: {
    type?: string;
    category?: string;
    level?: SentrySeverity;
    message?: string;
    data?: Record<string, unknown>;
  }) => void;
  captureException?: (exception: unknown, context?: Record<string, unknown>) => string | undefined;
  captureMessage?: (message: string, context?: Record<string, unknown>) => string | undefined;
}

export interface SentryTransportOptions {
  sentry: SentryLike;
  name?: string;
  minLevel?: LoggerLevel;
  structuredLogs?: boolean;
  breadcrumbs?: boolean;
  captureErrors?: boolean;
  captureMessages?: boolean;
  eventLevel?: LoggerLevel;
}

function sentrySeverity(event: LogEvent): SentrySeverity {
  if (event.levelName === "warn") return "warning";
  if (event.levelName === "trace") return "debug";
  return event.levelName;
}

function sentryLoggerMethod(event: LogEvent): keyof SentryLoggerLike {
  if (event.levelName === "warn") return "warn";
  if (event.levelName === "fatal") return "error";
  return event.levelName;
}

function serializedErrorToError(error: SerializedError): Error {
  const out = new Error(error.message);
  out.name = error.name ?? "Error";
  if (error.stack) out.stack = error.stack;
  Object.assign(out, error);
  return out;
}

function eventAttributes(event: LogEvent): Record<string, unknown> {
  return {
    "loggerjs.event_id": event.id,
    "loggerjs.seq": event.seq,
    "loggerjs.logger": event.logger,
    "loggerjs.type": event.type,
    "loggerjs.tags": event.tags,
    "loggerjs.context": event.context,
    "loggerjs.data": event.data,
    "loggerjs.trace": event.trace,
    "loggerjs.source": event.source,
    "loggerjs.error": event.error,
  };
}

function compactAttributes(attributes: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(attributes).filter(([, value]) => value !== undefined));
}

function sentryEventContext(event: LogEvent, attributes: Record<string, unknown>) {
  return {
    level: sentrySeverity(event),
    tags: event.tags,
    contexts: {
      loggerjs: {
        event_id: event.id,
        seq: event.seq,
        logger: event.logger,
        type: event.type,
        trace: event.trace,
        source: event.source,
      },
    },
    extra: attributes,
  };
}

export function sentryTransport(options: SentryTransportOptions): Transport {
  const structuredLogs = options.structuredLogs ?? true;
  const breadcrumbs = options.breadcrumbs ?? true;
  const captureErrors = options.captureErrors ?? true;
  const captureMessages = options.captureMessages ?? false;
  const eventLevel = toLevelValue(options.eventLevel ?? "error");

  return {
    name: options.name ?? "sentry",
    minLevel: options.minLevel,
    log(event) {
      if (options.minLevel !== undefined && event.level < toLevelValue(options.minLevel)) return;

      const attributes = compactAttributes(eventAttributes(event));
      if (structuredLogs) {
        const method = sentryLoggerMethod(event);
        options.sentry.logger?.[method]?.(event.message, attributes);
      }

      if (breadcrumbs) {
        options.sentry.addBreadcrumb?.({
          type: "log",
          category: event.logger,
          level: sentrySeverity(event),
          message: event.message,
          data: attributes,
        });
      }

      if (event.level < eventLevel) return;
      const context = sentryEventContext(event, attributes);
      if (event.error && captureErrors) {
        options.sentry.captureException?.(serializedErrorToError(event.error), context);
      } else if (captureMessages) {
        options.sentry.captureMessage?.(event.message, context);
      }
    },
  };
}
