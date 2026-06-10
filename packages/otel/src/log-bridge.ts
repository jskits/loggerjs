import { normalizeValue, type LogEvent, type LoggerLevel, type Transport } from "@loggerjs/core";
import { otelSeverityNumber, otelSeverityText } from "./severity";

export interface OpenTelemetryLogBridgeRecord {
  timestamp: number;
  observedTimestamp: number;
  severityNumber: number;
  severityText: string;
  body: unknown;
  attributes: Record<string, unknown>;
  traceId?: string;
  spanId?: string;
  traceFlags?: number;
}

export interface OpenTelemetryLoggerLike {
  emit: (record: OpenTelemetryLogBridgeRecord) => void;
}

export interface OpenTelemetryLoggerProviderLike {
  getLogger: (
    name: string,
    version?: string,
    options?: Record<string, unknown>,
  ) => OpenTelemetryLoggerLike;
  forceFlush?: () => void | Promise<void>;
  shutdown?: () => void | Promise<void>;
}

export interface OpenTelemetryLogBridgeOptions {
  name?: string;
  minLevel?: LoggerLevel;
  logger?: OpenTelemetryLoggerLike;
  loggerProvider?: OpenTelemetryLoggerProviderLike;
  loggerName?: string;
  loggerVersion?: string;
  loggerOptions?: Record<string, unknown>;
  includeData?: boolean;
  includeContext?: boolean;
  includeTags?: boolean;
  attributes?: Record<string, unknown>;
}

function normalizeAttribute(value: unknown) {
  return normalizeValue(value, { maxDepth: 6, maxArrayLength: 100, maxObjectKeys: 100 });
}

function traceFlagsToNumber(traceFlags: string | undefined) {
  if (traceFlags === undefined) return undefined;
  const flags = Number.parseInt(traceFlags, 16);
  return Number.isFinite(flags) ? flags : undefined;
}

function exceptionAttributes(error: LogEvent["error"]): Record<string, unknown> {
  if (!error) return {};
  return {
    "exception.type": error.name,
    "exception.message": error.message,
    "exception.stacktrace": error.stack,
    "exception.code": error.code,
    "exception.cause": normalizeAttribute(error.cause),
  };
}

function compactAttributes(attributes: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(attributes)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, normalizeAttribute(value)]),
  );
}

export function toOpenTelemetryLogBridgeRecord(
  event: LogEvent,
  options: OpenTelemetryLogBridgeOptions = {},
  observedTimestamp = Date.now(),
): OpenTelemetryLogBridgeRecord {
  return {
    timestamp: event.time,
    observedTimestamp,
    severityNumber: otelSeverityNumber[event.levelName],
    severityText: otelSeverityText(event.levelName),
    body: normalizeAttribute(event.message),
    attributes: compactAttributes({
      "loggerjs.event_id": event.id,
      "loggerjs.seq": event.seq,
      "loggerjs.logger": event.logger,
      "log.type": event.type,
      "log.source": event.source,
      "log.tags": options.includeTags === false ? undefined : event.tags,
      "log.context": options.includeContext === false ? undefined : event.context,
      "log.data": options.includeData === false ? undefined : event.data,
      ...exceptionAttributes(event.error),
      ...options.attributes,
    }),
    traceId: event.trace?.traceId,
    spanId: event.trace?.spanId,
    traceFlags: traceFlagsToNumber(event.trace?.traceFlags),
  };
}

export function openTelemetryLogBridgeTransport(
  options: OpenTelemetryLogBridgeOptions = {},
): Transport {
  const logger =
    options.logger ??
    options.loggerProvider?.getLogger(
      options.loggerName ?? "loggerjs",
      options.loggerVersion,
      options.loggerOptions,
    );

  return {
    name: options.name ?? "otel-log-bridge",
    minLevel: options.minLevel,
    log(event) {
      if (!logger) throw new Error("OpenTelemetry logger or loggerProvider is required.");
      logger.emit(toOpenTelemetryLogBridgeRecord(event, options));
    },
    flush: options.loggerProvider?.forceFlush
      ? () => options.loggerProvider?.forceFlush?.()
      : undefined,
    close: options.loggerProvider?.shutdown
      ? () => options.loggerProvider?.shutdown?.()
      : undefined,
  };
}
