import type { Integration, LoggerLike } from "@loggerjs/core";

export interface CaptureProcessOptions {
  uncaughtException?: boolean;
  unhandledRejection?: boolean;
  warning?: boolean;
  beforeExitFlush?: boolean;
}

export function captureProcessIntegration(options: CaptureProcessOptions = {}): Integration {
  const uncaughtException = options.uncaughtException ?? true;
  const unhandledRejection = options.unhandledRejection ?? true;
  const warning = options.warning ?? true;
  const beforeExitFlush = options.beforeExitFlush ?? true;

  return {
    name: "capture-process",
    setup(logger: LoggerLike) {
      const disposers: Array<() => void> = [];

      if (uncaughtException) {
        const onUncaughtException = (error: Error) => {
          logger.captureException(error, { source: { integration: "process.uncaughtException" } });
          void logger.flush();
        };
        process.on("uncaughtException", onUncaughtException);
        disposers.push(() => process.off("uncaughtException", onUncaughtException));
      }

      if (unhandledRejection) {
        const onUnhandledRejection = (reason: unknown) => {
          logger.captureException(reason, { source: { integration: "process.unhandledRejection" } });
          void logger.flush();
        };
        process.on("unhandledRejection", onUnhandledRejection);
        disposers.push(() => process.off("unhandledRejection", onUnhandledRejection));
      }

      if (warning) {
        const onWarning = (warn: Error) => {
          logger.warn(warn.message, { error: warn, source: { integration: "process.warning" } });
        };
        process.on("warning", onWarning);
        disposers.push(() => process.off("warning", onWarning));
      }

      if (beforeExitFlush) {
        const onBeforeExit = () => {
          void logger.flush();
        };
        process.on("beforeExit", onBeforeExit);
        disposers.push(() => process.off("beforeExit", onBeforeExit));
      }

      return () => {
        for (const dispose of disposers) dispose();
      };
    }
  };
}
