import type { LogEvent, Transport } from "../types";
import { safeJsonStringify } from "../utils/safe-stringify";

const ORIGINAL_CONSOLE_KEY = "__LOGGERJS_ORIGINAL_CONSOLE__";

type ConsoleMethod = "debug" | "info" | "warn" | "error" | "log";

function methodForEvent(event: LogEvent): ConsoleMethod {
  if (event.levelName === "trace" || event.levelName === "debug") return "debug";
  if (event.levelName === "warn") return "warn";
  if (event.levelName === "error" || event.levelName === "fatal") return "error";
  return "info";
}

function getConsoleMethod(method: ConsoleMethod): (...args: unknown[]) => void {
  const g = globalThis as unknown as Record<string, unknown>;
  const original = g[ORIGINAL_CONSOLE_KEY] as Partial<Record<ConsoleMethod, (...args: unknown[]) => void>> | undefined;
  const writer = original?.[method] ?? (console as unknown as Record<ConsoleMethod, (...args: unknown[]) => void>)[method] ?? console.log;
  return writer.bind(console);
}

export interface ConsoleTransportOptions {
  name?: string;
  pretty?: boolean;
  includeEvent?: boolean;
}

export function consoleTransport(options: ConsoleTransportOptions = {}): Transport {
  return {
    name: options.name ?? "console",
    log(event) {
      const writer = getConsoleMethod(methodForEvent(event));
      if (options.pretty ?? true) {
        const prefix = `[${new Date(event.time).toISOString()}] ${event.levelName.toUpperCase()} ${event.logger}:`;
        if (options.includeEvent) writer(prefix, event.message, event.data ?? "", event);
        else writer(prefix, event.message, event.data ?? "");
      } else {
        writer(safeJsonStringify(event));
      }
    }
  };
}
