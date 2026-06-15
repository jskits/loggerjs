import { registerUnpatchedDefaults } from "../integration-api";
import { safeJsonCodec } from "../codecs/json";
import { runtimeHost } from "../host";
import type { Codec, LogEvent, LogRecord, Transport, TransportContext } from "../types";

type ConsoleMethod = "debug" | "info" | "warn" | "error" | "log";

function methodForEvent(event: LogEvent): ConsoleMethod {
  if (event.levelName === "trace" || event.levelName === "debug") return "debug";
  if (event.levelName === "warn") return "warn";
  if (event.levelName === "error" || event.levelName === "fatal") return "error";
  return "info";
}

function getConsoleMethod(method: ConsoleMethod): (...args: unknown[]) => void {
  const registry = registerUnpatchedDefaults();
  const runtimeConsole = runtimeHost.console;
  const writer =
    registry.console[method] ?? runtimeConsole?.[method] ?? runtimeConsole?.log ?? (() => {});
  return runtimeConsole ? writer.bind(runtimeConsole) : writer;
}

function defaultFilter(event: LogEvent): boolean {
  const integration = event.source?.integration;
  return integration !== "capture-console" && integration !== "integration:capture-console";
}

export interface ConsoleTransportOptions {
  name?: string;
  pretty?: boolean;
  includeEvent?: boolean;
  codec?: Codec<string | Uint8Array>;
  filter?: (event: LogEvent) => boolean;
}

export function consoleTransport(options: ConsoleTransportOptions = {}): Transport {
  const codec = options.codec ?? safeJsonCodec();
  const filter = options.filter ?? defaultFilter;
  const writeEvent = (event: LogEvent) => {
    if (!filter(event)) return;
    const writer = getConsoleMethod(methodForEvent(event));
    if (options.pretty ?? true) {
      const prefix = `[${new Date(event.time).toISOString()}] ${event.levelName.toUpperCase()} ${event.logger}:`;
      const args: unknown[] = [prefix, event.message];
      if (event.data !== undefined) args.push(event.data);
      if (event.error !== undefined) args.push(event.error);
      if (options.includeEvent) args.push(event);
      writer(...args);
    } else {
      writer(codec.encode(event));
    }
  };
  const writeRecord = (record: LogRecord, context: TransportContext) => {
    writeEvent(context.toEvent(record));
  };

  return {
    name: options.name ?? "console",
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
