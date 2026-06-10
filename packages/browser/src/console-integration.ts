import {
  incrementLoggerMetaCounter,
  normalizeValue,
  type Integration,
  type IntegrationSetupContext,
  type LoggerLevel,
} from "@loggerjs/core";

type ConsoleLevel = "debug" | "info" | "log" | "trace" | "warn" | "error";

type ConsoleRecord = Partial<Record<ConsoleLevel, (...args: unknown[]) => void>>;

const defaultLevels: ConsoleLevel[] = ["debug", "info", "log", "trace", "warn", "error"];

const levelMap: Record<ConsoleLevel, LoggerLevel> = {
  debug: "debug",
  info: "info",
  log: "info",
  trace: "trace",
  warn: "warn",
  error: "error",
};

export interface CaptureConsoleOptions {
  levels?: ConsoleLevel[];
  preserveConsole?: boolean;
  captureArguments?: boolean;
  maxCapturesPerSecond?: number;
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

function reportRateLimitDrop() {
  incrementLoggerMetaCounter("integration.dropped");
  incrementLoggerMetaCounter("integration.dropped.rate-limit");
}

export function captureConsoleIntegration(options: CaptureConsoleOptions = {}): Integration {
  const levels = options.levels ?? defaultLevels;
  const preserveConsole = options.preserveConsole ?? true;
  const captureArguments = options.captureArguments ?? false;
  const maxCapturesPerSecond = options.maxCapturesPerSecond ?? 100;

  return {
    name: "capture-console",
    setup(api: IntegrationSetupContext) {
      if (typeof console === "undefined") return;
      const originals: ConsoleRecord = {};
      const boundOriginals: ConsoleRecord = {};
      let windowStarted = Date.now();
      let capturesInWindow = 0;
      let disposed = false;

      const shouldCapture = () => {
        const now = Date.now();
        if (now - windowStarted >= 1000) {
          windowStarted = now;
          capturesInWindow = 0;
        }
        if (capturesInWindow >= maxCapturesPerSecond) {
          reportRateLimitDrop();
          return false;
        }
        capturesInWindow += 1;
        return true;
      };

      for (const level of levels) {
        const original = (console as unknown as ConsoleRecord)[level] ?? console.log.bind(console);
        originals[level] = original;
        const unpatched = api.unpatched.console[level] ?? original;
        api.unpatched.console[level] ??= original;
        boundOriginals[level] = unpatched.bind(console);

        const capture = api.guard((args: unknown[]) => {
          if (!shouldCapture()) return;
          const consoleData: Record<string, unknown> = { level };
          if (captureArguments) {
            consoleData.arguments = normalizeValue(args, { maxDepth: 4 });
          }
          api.capture({
            level: levelMap[level],
            message: formatConsoleMessage(args),
            props: { console: consoleData },
          });
        });

        (console as unknown as ConsoleRecord)[level] = (...args: unknown[]) => {
          capture(args);
          if (preserveConsole) boundOriginals[level]?.(...args);
        };
      }

      return () => {
        if (disposed) return;
        disposed = true;
        for (const level of levels) {
          if (originals[level]) (console as unknown as ConsoleRecord)[level] = originals[level];
        }
      };
    },
  };
}
