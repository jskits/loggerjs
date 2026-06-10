import { normalizeValue, type Integration, type LoggerLike } from "@loggerjs/core";

export interface CaptureBrowserErrorsOptions {
  captureWindowError?: boolean;
  captureUnhandledRejection?: boolean;
  captureResourceErrors?: boolean;
}

function resourceInfo(target: unknown): Record<string, unknown> {
  const element = target as { tagName?: string; src?: string; href?: string; currentSrc?: string; outerHTML?: string } | null;
  return {
    tagName: element?.tagName,
    url: element?.src || element?.currentSrc || element?.href,
    html: element?.outerHTML?.slice(0, 500)
  };
}

export function captureBrowserErrorsIntegration(options: CaptureBrowserErrorsOptions = {}): Integration {
  const captureWindowError = options.captureWindowError ?? true;
  const captureUnhandledRejection = options.captureUnhandledRejection ?? true;
  const captureResourceErrors = options.captureResourceErrors ?? true;

  return {
    name: "capture-browser-errors",
    setup(logger: LoggerLike) {
      const disposers: Array<() => void> = [];

      if (captureWindowError && typeof addEventListener !== "undefined") {
        const onError = (event: ErrorEvent | Event) => {
          if ("error" in event && event.error) {
            logger.captureException(event.error, {
              source: {
                integration: "window.error",
                file: event.filename,
                line: event.lineno,
                column: event.colno
              }
            });
            return;
          }

          if (captureResourceErrors) {
            logger.error("Browser resource load error", {
              source: {
                integration: "resource.error",
                ...resourceInfo((event as Event).target)
              }
            });
          }
        };
        addEventListener("error", onError, true);
        disposers.push(() => removeEventListener("error", onError, true));
      }

      if (captureUnhandledRejection && typeof addEventListener !== "undefined") {
        const onUnhandledRejection = (event: PromiseRejectionEvent) => {
          const reason = event.reason;
          if (reason instanceof Error) {
            logger.captureException(reason, { source: { integration: "unhandledrejection" } });
          } else {
            logger.error("Unhandled promise rejection", {
              source: { integration: "unhandledrejection" },
              reason: normalizeValue(reason, { maxDepth: 5 })
            });
          }
        };
        addEventListener("unhandledrejection", onUnhandledRejection);
        disposers.push(() => removeEventListener("unhandledrejection", onUnhandledRejection));
      }

      return () => {
        for (const dispose of disposers) dispose();
      };
    }
  };
}
