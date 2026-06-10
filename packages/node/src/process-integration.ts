import {
  normalizeValue,
  type CaptureInput,
  type Integration,
  type IntegrationSetupContext,
} from "@loggerjs/core";

export interface CaptureProcessOptions {
  uncaughtException?: boolean;
  unhandledRejection?: boolean;
  warning?: boolean;
  beforeExitFlush?: boolean;
  exitFlush?: boolean;
  exitOnUncaught?: boolean;
  flushTimeoutMs?: number;
  exitFn?: (code: number) => void;
}

export function captureProcessIntegration(options: CaptureProcessOptions = {}): Integration {
  const uncaughtException = options.uncaughtException ?? true;
  const unhandledRejection = options.unhandledRejection ?? true;
  const warning = options.warning ?? true;
  const beforeExitFlush = options.beforeExitFlush ?? true;
  const exitFlush = options.exitFlush ?? true;
  const exitOnUncaught = options.exitOnUncaught ?? true;
  const flushTimeoutMs = options.flushTimeoutMs ?? 250;
  const exitFn = options.exitFn ?? ((code: number) => process.exit(code));

  return {
    name: "capture-process",
    setup(api: IntegrationSetupContext) {
      const disposers: Array<() => void> = [];
      let disposed = false;

      const capture = api.guard((input: CaptureInput) => api.capture(input));
      const flushSync = () => {
        try {
          api.flushSync?.();
        } catch {
          // Logger.flushSync reports transport errors; this protects custom IntegrationAPI contexts.
        }
      };
      const flushBounded = async () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            api.flush(),
            new Promise<void>((resolve) => {
              timer = setTimeout(resolve, flushTimeoutMs);
            }),
          ]);
        } catch {
          // Process handlers must not throw back into fatal runtime paths.
        } finally {
          if (timer) clearTimeout(timer);
        }
      };
      const flushBestEffort = () => {
        flushSync();
        void flushBounded();
      };

      if (uncaughtException) {
        const onUncaughtException = (error: Error) => {
          capture({
            level: "fatal",
            message: error.message,
            error,
            props: { process: { kind: "uncaughtException" } },
          });
          flushSync();
          const flushed = flushBounded();
          if (exitOnUncaught) void flushed.finally(() => exitFn(1));
        };
        process.on("uncaughtException", onUncaughtException);
        disposers.push(() => process.off("uncaughtException", onUncaughtException));
      }

      if (unhandledRejection) {
        const onUnhandledRejection = (reason: unknown) => {
          capture({
            level: "error",
            message: reason instanceof Error ? reason.message : "Unhandled promise rejection",
            error: reason,
            props: {
              process: { kind: "unhandledRejection" },
              reason: normalizeValue(reason, { maxDepth: 5 }),
            },
          });
          flushBestEffort();
        };
        process.on("unhandledRejection", onUnhandledRejection);
        disposers.push(() => process.off("unhandledRejection", onUnhandledRejection));
      }

      if (warning) {
        const onWarning = (warn: Error) => {
          capture({
            level: "warn",
            message: warn.message,
            error: warn,
            props: {
              process: {
                kind: "warning",
                name: warn.name,
                code: (warn as Error & { code?: string }).code,
              },
            },
          });
        };
        process.on("warning", onWarning);
        disposers.push(() => process.off("warning", onWarning));
      }

      if (beforeExitFlush) {
        const onBeforeExit = () => {
          void flushBounded();
        };
        process.on("beforeExit", onBeforeExit);
        disposers.push(() => process.off("beforeExit", onBeforeExit));
      }

      if (exitFlush) {
        const onExit = () => {
          flushSync();
        };
        process.on("exit", onExit);
        disposers.push(() => process.off("exit", onExit));
      }

      return () => {
        if (disposed) return;
        disposed = true;
        for (const dispose of disposers) dispose();
      };
    },
  };
}
