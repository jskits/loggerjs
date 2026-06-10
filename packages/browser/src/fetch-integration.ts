import { normalizeValue, type Integration, type LoggerLike } from "@loggerjs/core";

export interface CaptureFetchOptions {
  minStatus?: number;
  captureRequestHeaders?: boolean;
  captureResponseHeaders?: boolean;
  captureSuccessful?: boolean;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof input === "object" && "method" in input && input.method) return input.method.toUpperCase();
  return "GET";
}

function headersToObject(headers: Headers | undefined): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

export function captureFetchIntegration(options: CaptureFetchOptions = {}): Integration {
  const minStatus = options.minStatus ?? 400;
  return {
    name: "capture-fetch",
    setup(logger: LoggerLike) {
      const original = globalThis.fetch;
      if (!original) return;

      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const started = typeof performance !== "undefined" ? performance.now() : Date.now();
        const url = requestUrl(input);
        const method = requestMethod(input, init);
        try {
          const response = await original(input, init);
          const durationMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - started;
          if (options.captureSuccessful || response.status >= minStatus) {
            logger.log(response.status >= minStatus ? "warn" : "debug", `Fetch ${response.status} ${method} ${url}`, {
              http: {
                method,
                url,
                status: response.status,
                ok: response.ok,
                durationMs,
                requestHeaders: options.captureRequestHeaders && init?.headers instanceof Headers ? headersToObject(init.headers) : undefined,
                responseHeaders: options.captureResponseHeaders ? headersToObject(response.headers) : undefined
              },
              source: { integration: "fetch" }
            });
          }
          return response;
        } catch (error) {
          const durationMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - started;
          logger.captureException(error, {
            http: { method, url, durationMs },
            source: { integration: "fetch" },
            input: normalizeValue(input, { maxDepth: 3 })
          });
          throw error;
        }
      };

      return () => {
        globalThis.fetch = original;
      };
    }
  };
}
