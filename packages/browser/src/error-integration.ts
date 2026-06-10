import {
  incrementLoggerMetaCounter,
  normalizeValue,
  type Integration,
  type IntegrationSetupContext,
} from "@loggerjs/core";

export interface CaptureBrowserErrorsOptions {
  captureWindowError?: boolean;
  captureUnhandledRejection?: boolean;
  captureResourceErrors?: boolean;
  captureSecurityPolicyViolation?: boolean;
  scriptErrorDedupeWindowMs?: number;
}

function resourceInfo(target: unknown): Record<string, unknown> {
  const element = target as {
    tagName?: string;
    src?: string;
    href?: string;
    currentSrc?: string;
    outerHTML?: string;
  } | null;
  return {
    tagName: element?.tagName,
    url: element?.src || element?.currentSrc || element?.href,
    html: element?.outerHTML?.slice(0, 500),
  };
}

function reportDrop(reason: string) {
  incrementLoggerMetaCounter("integration.dropped");
  incrementLoggerMetaCounter(`integration.dropped.${reason}`);
}

export function captureBrowserErrorsIntegration(
  options: CaptureBrowserErrorsOptions = {},
): Integration {
  const captureWindowError = options.captureWindowError ?? true;
  const captureUnhandledRejection = options.captureUnhandledRejection ?? true;
  const captureResourceErrors = options.captureResourceErrors ?? true;
  const captureSecurityPolicyViolation = options.captureSecurityPolicyViolation ?? false;
  const scriptErrorDedupeWindowMs = options.scriptErrorDedupeWindowMs ?? 1000;

  return {
    name: "capture-browser-errors",
    setup(api: IntegrationSetupContext) {
      const disposers: Array<() => void> = [];
      let lastScriptErrorAt = 0;
      let disposed = false;

      const shouldDropScriptError = (message: string | undefined) => {
        if (message !== "Script error.") return false;
        const now = Date.now();
        if (now - lastScriptErrorAt <= scriptErrorDedupeWindowMs) {
          reportDrop("script-error-duplicate");
          return true;
        }
        lastScriptErrorAt = now;
        return false;
      };

      if (captureWindowError && typeof addEventListener !== "undefined") {
        const onError = api.guard((event: ErrorEvent | Event) => {
          const errorEvent = event as ErrorEvent;
          if ("message" in errorEvent && shouldDropScriptError(errorEvent.message)) return;

          if ("error" in errorEvent && errorEvent.error) {
            api.capture({
              level: "error",
              message: errorEvent.message || errorEvent.error.message,
              error: errorEvent.error,
              props: {
                browser: {
                  kind: "script-error",
                  file: errorEvent.filename,
                  line: errorEvent.lineno,
                  column: errorEvent.colno,
                },
              },
            });
            return;
          }

          if ("message" in errorEvent && errorEvent.message) {
            api.capture({
              level: "error",
              message: errorEvent.message,
              props: {
                browser: {
                  kind: "script-error",
                  file: errorEvent.filename,
                  line: errorEvent.lineno,
                  column: errorEvent.colno,
                },
              },
            });
            return;
          }

          if (captureResourceErrors) {
            api.capture({
              level: "error",
              message: "Browser resource load error",
              props: {
                browser: {
                  kind: "resource-error",
                  ...resourceInfo((event as Event).target),
                },
              },
            });
          }
        });
        addEventListener("error", onError, true);
        disposers.push(() => removeEventListener("error", onError, true));
      }

      if (captureUnhandledRejection && typeof addEventListener !== "undefined") {
        const onUnhandledRejection = api.guard((event: PromiseRejectionEvent) => {
          const reason = event.reason;
          api.capture({
            level: "error",
            message: reason instanceof Error ? reason.message : "Unhandled promise rejection",
            error: reason,
            props: {
              browser: { kind: "unhandledrejection" },
              reason: normalizeValue(reason, { maxDepth: 5 }),
            },
          });
        });
        addEventListener("unhandledrejection", onUnhandledRejection);
        disposers.push(() => removeEventListener("unhandledrejection", onUnhandledRejection));
      }

      if (captureSecurityPolicyViolation && typeof addEventListener !== "undefined") {
        const onSecurityPolicyViolation = api.guard((event: SecurityPolicyViolationEvent) => {
          api.capture({
            level: "warn",
            message: `Security policy violation: ${event.violatedDirective}`,
            props: {
              browser: {
                kind: "securitypolicyviolation",
                blockedURI: event.blockedURI,
                documentURI: event.documentURI,
                file: event.sourceFile,
                line: event.lineNumber,
                column: event.columnNumber,
                originalPolicy: event.originalPolicy,
                effectiveDirective: event.effectiveDirective,
              },
            },
          });
        });
        addEventListener("securitypolicyviolation", onSecurityPolicyViolation);
        disposers.push(() =>
          removeEventListener("securitypolicyviolation", onSecurityPolicyViolation),
        );
      }

      return () => {
        if (disposed) return;
        disposed = true;
        for (const dispose of disposers) dispose();
      };
    },
  };
}
