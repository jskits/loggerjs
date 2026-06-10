import { normalizeValue, type Integration, type LoggerLike } from "@loggerjs/core";

const ORIGINAL_CONSOLE_KEY = "__LOGGERJS_ORIGINAL_CONSOLE__";

type ConsoleLevel = "debug" | "info" | "log" | "warn" | "error";

type ConsoleRecord = Partial<Record<ConsoleLevel, (...args: unknown[]) => void>>;

const levelMap: Record<ConsoleLevel, "debug" | "info" | "warn" | "error"> = {
  debug: "debug",
  info: "info",
  log: "info",
  warn: "warn",
  error: "error",
};

export interface CaptureConsoleOptions {
  levels?: ConsoleLevel[];
  preserveConsole?: boolean;
  captureArguments?: boolean;
}

function formatConsoleMessage(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === "string") return arg;
      if (arg instanceof Error) return arg.message;
      try {
        return JSON.stringify(
          normalizeValue(arg, { maxDepth: 3, maxArrayLength: 20, maxObjectKeys: 40 }),
        );
      } catch {
        return String(arg);
      }
    })
    .join(" ");
}

function originalRegistry(): ConsoleRecord {
  const g = globalThis as unknown as Record<string, unknown>;
  if (!g[ORIGINAL_CONSOLE_KEY]) g[ORIGINAL_CONSOLE_KEY] = {};
  return g[ORIGINAL_CONSOLE_KEY] as ConsoleRecord;
}

export function captureConsoleIntegration(options: CaptureConsoleOptions = {}): Integration {
  const levels = options.levels ?? ["warn", "error"];
  const preserveConsole = options.preserveConsole ?? true;
  const captureArguments = options.captureArguments ?? true;

  return {
    name: "capture-console",
    setup(logger: LoggerLike) {
      if (typeof console === "undefined") return;
      const originals: ConsoleRecord = {};
      const boundOriginals: ConsoleRecord = {};
      const registry = originalRegistry();
      let guard = false;

      for (const level of levels) {
        const original = (console as unknown as ConsoleRecord)[level] ?? console.log.bind(console);
        originals[level] = original;
        boundOriginals[level] = original.bind(console);
        if (!registry[level]) registry[level] = boundOriginals[level];

        (console as unknown as ConsoleRecord)[level] = (...args: unknown[]) => {
          if (guard) {
            boundOriginals[level]?.(...args);
            return;
          }
          guard = true;
          try {
            logger.log(levelMap[level], formatConsoleMessage(args), {
              console: {
                level,
                arguments: captureArguments ? normalizeValue(args, { maxDepth: 4 }) : undefined,
              },
            });
          } finally {
            guard = false;
          }
          if (preserveConsole) boundOriginals[level]?.(...args);
        };
      }

      return () => {
        for (const level of levels) {
          if (originals[level]) (console as unknown as ConsoleRecord)[level] = originals[level];
        }
      };
    },
  };
}
