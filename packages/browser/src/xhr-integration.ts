import type { CaptureInput, Integration, IntegrationSetupContext } from "@loggerjs/core";
import { durationMs, nowMs, sanitizeHttpUrl, shouldSample } from "./http-capture-utils";

export interface CaptureXHROptions {
  minStatus?: number;
  captureAll?: boolean;
  captureSuccessful?: boolean;
  sampleRate?: number;
  random?: () => number;
  sanitizeUrl?: (url: string) => string;
}

interface XHRMeta {
  method: string;
  url: string;
  started: number;
}

const XHR_META = "__LOGGERJS_XHR_META__";

export function captureXHRIntegration(options: CaptureXHROptions = {}): Integration {
  const minStatus = options.minStatus ?? 400;
  const captureAll = options.captureAll ?? options.captureSuccessful ?? false;
  const sampleRate = options.sampleRate ?? 1;
  const random = options.random ?? Math.random;

  return {
    name: "capture-xhr",
    setup(api: IntegrationSetupContext) {
      if (typeof XMLHttpRequest === "undefined") return;
      const proto = XMLHttpRequest.prototype;
      const originalOpen = proto.open;
      const originalSend = proto.send;
      api.unpatched.XMLHttpRequest ??= XMLHttpRequest;
      const capture = api.guard((input: CaptureInput) => api.capture(input));

      proto.open = function patchedOpen(
        this: XMLHttpRequest,
        method: string,
        url: string | URL,
        ...rest: unknown[]
      ) {
        (this as unknown as Record<string, XHRMeta>)[XHR_META] = {
          method: method.toUpperCase(),
          url: sanitizeHttpUrl(String(url), options.sanitizeUrl),
          started: 0,
        };
        return (originalOpen as unknown as (...args: unknown[]) => void).apply(this, [
          method,
          url,
          ...rest,
        ]);
      };

      proto.send = function patchedSend(
        this: XMLHttpRequest,
        body?: Document | XMLHttpRequestBodyInit | null,
      ) {
        const meta = (this as unknown as Record<string, XHRMeta>)[XHR_META];
        if (meta) meta.started = nowMs();
        let captured = false;

        const onLoadEnd = () => {
          if (!meta || captured) return;
          const shouldCapture =
            this.status >= minStatus || (captureAll && shouldSample(sampleRate, random));
          if (shouldCapture) {
            captured = true;
            capture({
              level: this.status >= minStatus ? "warn" : "debug",
              message: `XHR ${this.status} ${meta.method} ${meta.url}`,
              props: {
                http: {
                  kind: "xhr",
                  method: meta.method,
                  url: meta.url,
                  status: this.status,
                  durationMs: durationMs(meta.started),
                },
              },
            });
          }
        };

        const onError = () => {
          if (!meta || captured) return;
          captured = true;
          capture({
            level: "error",
            message: `XHR network error ${meta.method} ${meta.url}`,
            props: {
              http: {
                kind: "xhr",
                method: meta.method,
                url: meta.url,
                durationMs: durationMs(meta.started),
              },
            },
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
    },
  };
}
