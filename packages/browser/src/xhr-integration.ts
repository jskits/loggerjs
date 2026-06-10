import type { Integration, LoggerLike } from "@loggerjs/core";

export interface CaptureXHROptions {
  minStatus?: number;
  captureSuccessful?: boolean;
}

interface XHRMeta {
  method: string;
  url: string;
  started: number;
}

const XHR_META = "__LOGGERJS_XHR_META__";

export function captureXHRIntegration(options: CaptureXHROptions = {}): Integration {
  const minStatus = options.minStatus ?? 400;
  return {
    name: "capture-xhr",
    setup(logger: LoggerLike) {
      if (typeof XMLHttpRequest === "undefined") return;
      const proto = XMLHttpRequest.prototype;
      const originalOpen = proto.open;
      const originalSend = proto.send;

      proto.open = function patchedOpen(this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
        (this as unknown as Record<string, XHRMeta>)[XHR_META] = {
          method: method.toUpperCase(),
          url: String(url),
          started: 0
        };
        return (originalOpen as unknown as (...args: unknown[]) => void).apply(this, [method, url, ...rest]);
      };

      proto.send = function patchedSend(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
        const meta = (this as unknown as Record<string, XHRMeta>)[XHR_META];
        if (meta) meta.started = typeof performance !== "undefined" ? performance.now() : Date.now();

        const onLoadEnd = () => {
          if (!meta) return;
          const durationMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - meta.started;
          if (options.captureSuccessful || this.status >= minStatus) {
            logger.log(this.status >= minStatus ? "warn" : "debug", `XHR ${this.status} ${meta.method} ${meta.url}`, {
              http: {
                method: meta.method,
                url: meta.url,
                status: this.status,
                durationMs
              },
              source: { integration: "xhr" }
            });
          }
        };

        const onError = () => {
          if (!meta) return;
          const durationMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - meta.started;
          logger.error(`XHR network error ${meta.method} ${meta.url}`, {
            http: { method: meta.method, url: meta.url, durationMs },
            source: { integration: "xhr" }
          });
        };

        this.addEventListener("loadend", onLoadEnd, { once: true });
        this.addEventListener("error", onError, { once: true });
        return (originalSend as unknown as (...args: unknown[]) => void).apply(this, [body]);
      };

      return () => {
        proto.open = originalOpen;
        proto.send = originalSend;
      };
    }
  };
}
