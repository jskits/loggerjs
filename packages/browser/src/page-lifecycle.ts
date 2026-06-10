import type { Integration, LoggerLike } from "@loggerjs/core";

export function pageLifecycleIntegration(): Integration {
  return {
    name: "page-lifecycle",
    setup(logger: LoggerLike) {
      const flush = () => {
        void logger.flush();
      };
      const onVisibility = () => {
        if (document.visibilityState === "hidden") flush();
      };
      addEventListener("pagehide", flush);
      addEventListener("visibilitychange", onVisibility);
      return () => {
        removeEventListener("pagehide", flush);
        removeEventListener("visibilitychange", onVisibility);
      };
    }
  };
}
