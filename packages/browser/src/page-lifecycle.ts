import type { Integration, IntegrationSetupContext } from "@loggerjs/core";

export interface PageLifecycleOptions {
  flushOnPageHide?: boolean;
  flushOnHidden?: boolean;
  coalesceMs?: number;
}

export function pageLifecycleIntegration(options: PageLifecycleOptions = {}): Integration {
  const flushOnPageHide = options.flushOnPageHide ?? true;
  const flushOnHidden = options.flushOnHidden ?? true;
  const coalesceMs = options.coalesceMs ?? 250;

  return {
    name: "page-lifecycle",
    setup(api: IntegrationSetupContext) {
      if (typeof addEventListener === "undefined") return;
      let disposed = false;
      let flushInFlight: Promise<void> | undefined;
      let lastFlushAt = 0;

      const flush = () => {
        const now = Date.now();
        if (flushInFlight || now - lastFlushAt < coalesceMs) return;
        lastFlushAt = now;
        flushInFlight = Promise.resolve(api.flush())
          .catch(() => {})
          .finally(() => {
            flushInFlight = undefined;
          });
      };
      const onVisibility = () => {
        if (typeof document !== "undefined" && document.visibilityState === "hidden") flush();
      };
      if (flushOnPageHide) addEventListener("pagehide", flush);
      if (flushOnHidden) addEventListener("visibilitychange", onVisibility);
      return () => {
        if (disposed) return;
        disposed = true;
        if (flushOnPageHide) removeEventListener("pagehide", flush);
        if (flushOnHidden) removeEventListener("visibilitychange", onVisibility);
      };
    },
  };
}
