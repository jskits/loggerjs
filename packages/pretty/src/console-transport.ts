import {
  registerUnpatchedDefaults,
  type ConsoleMethod,
  type LogEvent,
  type LogRecord,
  type Transport,
  type TransportContext,
} from "@loggerjs/core";
import { formatPrettyEvent, type PrettyFormatterOptions } from "./formatter";

export interface PrettyConsoleLike {
  debug?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
  info?: (...args: unknown[]) => void;
  log?: (...args: unknown[]) => void;
  trace?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
}

export interface PrettyConsoleTransportOptions extends PrettyFormatterOptions {
  name?: string;
  browserStyles?: boolean | "auto";
  includeEvent?: boolean;
  console?: PrettyConsoleLike;
  filter?: (event: LogEvent) => boolean;
}

function methodForEvent(event: LogEvent): ConsoleMethod {
  if (event.levelName === "trace") return "trace";
  if (event.levelName === "debug") return "debug";
  if (event.levelName === "warn") return "warn";
  if (event.levelName === "error" || event.levelName === "fatal") return "error";
  return "info";
}

function defaultFilter(event: LogEvent): boolean {
  const integration = event.source?.integration;
  return integration !== "capture-console" && integration !== "integration:capture-console";
}

function browserStyleSupport(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function shouldUseBrowserStyles(value: boolean | "auto" | undefined): boolean {
  if (value === undefined || value === "auto") return browserStyleSupport();
  return value;
}

function writerFor(method: ConsoleMethod, target: PrettyConsoleLike | undefined) {
  if (target) {
    const writer =
      target[method] ??
      target.log ??
      target.info ??
      (() => {
        // Intentionally empty: callers can inject a partial console in tests.
      });
    return writer.bind(target);
  }

  const registry = registerUnpatchedDefaults();
  const fallback: PrettyConsoleLike =
    typeof console === "undefined" ? {} : (console as unknown as PrettyConsoleLike);
  const writer =
    registry.console[method] ??
    fallback[method] ??
    registry.console.log ??
    fallback.log ??
    (() => {
      // No console surface exists in this runtime.
    });

  return typeof console === "undefined" ? writer : writer.bind(console);
}

export function prettyConsoleTransport(options: PrettyConsoleTransportOptions = {}): Transport {
  const filter = options.filter ?? defaultFilter;
  const useBrowserStyles = shouldUseBrowserStyles(options.browserStyles);

  const writeEvent = (event: LogEvent) => {
    if (!filter(event)) return;
    const rendered = formatPrettyEvent(event, options);
    const writer = writerFor(methodForEvent(event), options.console);
    const args = useBrowserStyles
      ? rendered.browserArgs
      : [
          options.colors === "always" ? rendered.ansiText : rendered.text,
          ...rendered.details.map((detail) => detail.value),
        ];
    if (options.includeEvent) args.push(event);
    writer(...args);
  };

  const writeRecord = (record: LogRecord, context: TransportContext) => {
    writeEvent(context.toEvent(record));
  };

  return {
    name: options.name ?? "pretty-console",
    write(record, context) {
      writeRecord(record, context);
    },
    writeBatch(records, context) {
      for (const record of records) writeRecord(record, context);
    },
    log(event) {
      writeEvent(event);
    },
    logBatch(events) {
      for (const event of events) writeEvent(event);
    },
  };
}
