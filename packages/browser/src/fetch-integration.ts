import {
  normalizeValue,
  type CaptureInput,
  type Integration,
  type IntegrationSetupContext,
} from "@loggerjs/core";
import {
  durationMs,
  headersFromInit,
  nowMs,
  pickAllowedHeaders,
  sanitizeHttpUrl,
  shouldSample,
} from "./http-capture-utils";

export interface CaptureFetchOptions {
  minStatus?: number;
  captureRequestHeaders?: readonly string[];
  captureResponseHeaders?: readonly string[];
  captureAll?: boolean;
  captureSuccessful?: boolean;
  sampleRate?: number;
  random?: () => number;
  sanitizeUrl?: (url: string) => string;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof input === "object" && "method" in input && input.method)
    return input.method.toUpperCase();
  return "GET";
}

export function captureFetchIntegration(options: CaptureFetchOptions = {}): Integration {
  const minStatus = options.minStatus ?? 400;
  const captureAll = options.captureAll ?? options.captureSuccessful ?? false;
  const sampleRate = options.sampleRate ?? 1;
  const random = options.random ?? Math.random;

  return {
    name: "capture-fetch",
    setup(api: IntegrationSetupContext) {
      const current = globalThis.fetch;
      if (!current) return;
      const original = api.unpatched.fetch ?? current.bind(globalThis);
      api.unpatched.fetch ??= original;

      const capture = api.guard((input: CaptureInput) => api.capture(input));

      globalThis.fetch = async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        const started = nowMs();
        const url = sanitizeHttpUrl(requestUrl(input), options.sanitizeUrl);
        const method = requestMethod(input, init);
        try {
          const response = await original(input, init);
          const shouldCapture =
            response.status >= minStatus || (captureAll && shouldSample(sampleRate, random));
          if (shouldCapture) {
            capture({
              level: response.status >= minStatus ? "warn" : "debug",
              message: `Fetch ${response.status} ${method} ${url}`,
              props: {
                http: {
                  kind: "fetch",
                  method,
                  url,
                  status: response.status,
                  ok: response.ok,
                  durationMs: durationMs(started),
                  requestHeaders: pickAllowedHeaders(
                    headersFromInit(init?.headers),
                    options.captureRequestHeaders,
                  ),
                  responseHeaders: pickAllowedHeaders(
                    response.headers,
                    options.captureResponseHeaders,
                  ),
                },
              },
            });
          }
          return response;
        } catch (error) {
          capture({
            level: "error",
            message: `Fetch network error ${method} ${url}`,
            error,
            props: {
              http: { kind: "fetch", method, url, durationMs: durationMs(started) },
              input: normalizeValue(input, { maxDepth: 3 }),
            },
          });
          throw error;
        }
      };

      return () => {
        globalThis.fetch = current;
      };
    },
  };
}
