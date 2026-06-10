import {
  type CaptureInput,
  type Integration,
  type IntegrationSetupContext,
  type LoggerLevel,
} from "@loggerjs/core";

export interface NodeFetchHeadersLike {
  get?: (name: string) => string | null;
  [key: string]: unknown;
}

export interface NodeFetchRequestLike {
  url?: string;
  method?: string;
  headers?: NodeFetchHeadersLike | Record<string, unknown>;
}

export interface NodeFetchInitLike {
  method?: string;
  headers?: NodeFetchHeadersLike | Record<string, unknown>;
}

export interface NodeFetchResponseLike {
  status?: number;
  headers?: NodeFetchHeadersLike | Record<string, unknown>;
}

export type NodeFetchFunction = (
  input: string | URL | NodeFetchRequestLike,
  init?: NodeFetchInitLike,
) => Promise<NodeFetchResponseLike>;

export interface NodeFetchTargetLike {
  fetch?: NodeFetchFunction;
}

export interface NodeFetchRequestInfo {
  method: string;
  url: string;
  requestHeaders?: Record<string, string>;
}

export interface NodeFetchIntegrationOptions {
  name?: string;
  minStatus?: number;
  captureAll?: boolean;
  captureSuccessful?: boolean;
  sampleRate?: number;
  random?: () => number;
  captureRequestHeaders?: readonly string[];
  captureResponseHeaders?: readonly string[];
  sanitizeUrl?: (url: string) => string;
  level?: (status: number | undefined, error: unknown, info: NodeFetchRequestInfo) => LoggerLevel;
  target?: NodeFetchTargetLike;
}

const defaultRandom = () => Math.random();

function defaultSanitizeUrl(url: string): string {
  const queryIndex = url.indexOf("?");
  const hashIndex = url.indexOf("#");
  const end = Math.min(
    queryIndex >= 0 ? queryIndex : url.length,
    hashIndex >= 0 ? hashIndex : url.length,
  );
  return url.slice(0, end);
}

function defaultLevel(status: number | undefined, error: unknown): LoggerLevel {
  if (error || status === undefined || status >= 500) return "error";
  if (status >= 400) return "warn";
  return "info";
}

function isUrlLike(value: unknown): value is URL {
  return typeof URL !== "undefined" && value instanceof URL;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function headerValue(headers: unknown, name: string): string | undefined {
  if (!isObject(headers)) return undefined;
  if (typeof (headers as NodeFetchHeadersLike).get === "function") {
    return (headers as NodeFetchHeadersLike).get?.(name) ?? undefined;
  }
  const value = headers[name.toLowerCase()] ?? headers[name];
  return value === undefined ? undefined : String(value);
}

function pickHeaders(
  headers: unknown,
  names: readonly string[] | undefined,
): Record<string, string> | undefined {
  if (!names || names.length === 0) return undefined;
  const out: Record<string, string> = {};
  for (const name of names) {
    const lowerName = name.toLowerCase();
    const value = headerValue(headers, lowerName) ?? headerValue(headers, name);
    if (value !== undefined) out[lowerName] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function requestInfo(
  input: string | URL | NodeFetchRequestLike,
  init: NodeFetchInitLike | undefined,
  sanitizeUrl: (url: string) => string,
  captureRequestHeaders: readonly string[] | undefined,
): NodeFetchRequestInfo {
  const request =
    isObject(input) && !isUrlLike(input) ? (input as NodeFetchRequestLike) : undefined;
  const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
  const url = isUrlLike(input)
    ? input.href
    : typeof input === "string"
      ? input
      : (request?.url ?? "/");
  return {
    method,
    url: sanitizeUrl(url),
    requestHeaders: pickHeaders(init?.headers ?? request?.headers, captureRequestHeaders),
  };
}

function statusMessage(status: number | undefined) {
  return status === undefined ? "unknown" : String(status);
}

export function nodeFetchIntegration(options: NodeFetchIntegrationOptions = {}): Integration {
  const name = options.name ?? "node-fetch";
  const minStatus = options.minStatus ?? 400;
  const captureAll = options.captureAll ?? options.captureSuccessful ?? false;
  const sampleRate = options.sampleRate ?? 1;
  const random = options.random ?? defaultRandom;
  const sanitizeUrl = options.sanitizeUrl ?? defaultSanitizeUrl;
  const levelFor = options.level ?? defaultLevel;

  const shouldCapture = (status: number | undefined, error: unknown) => {
    if (error) return true;
    if (status !== undefined && status >= minStatus) return true;
    if (!captureAll) return false;
    return sampleRate >= 1 || random() < sampleRate;
  };

  return {
    name: "node-fetch",
    setup(api: IntegrationSetupContext) {
      const target = options.target ?? (globalThis as unknown as NodeFetchTargetLike);
      if (!target.fetch) return;

      const originalFetch = target.fetch;
      const capture = api.guard((input: CaptureInput) => api.capture(input));
      let disposed = false;

      const captureResult = (
        info: NodeFetchRequestInfo,
        durationMs: number,
        status: number | undefined,
        error: unknown,
        responseHeaders?: Record<string, string>,
      ) => {
        if (disposed || !shouldCapture(status, error)) return;
        capture({
          level: levelFor(status, error, info),
          message: error
            ? `Fetch error ${info.method} ${info.url}`
            : `Fetch ${statusMessage(status)} ${info.method} ${info.url}`,
          error,
          props: {
            http: {
              kind: name,
              runtime: "node",
              instrument: "fetch",
              direction: "outgoing",
              method: info.method,
              url: info.url,
              status,
              durationMs,
              requestHeaders: info.requestHeaders,
              responseHeaders,
            },
          },
        });
      };

      target.fetch = async function patchedFetch(
        this: unknown,
        input: string | URL | NodeFetchRequestLike,
        init?: NodeFetchInitLike,
      ) {
        const started = Date.now();
        const info = requestInfo(input, init, sanitizeUrl, options.captureRequestHeaders);
        try {
          const response = await originalFetch.call(this, input, init);
          captureResult(
            info,
            Date.now() - started,
            response.status,
            undefined,
            pickHeaders(response.headers, options.captureResponseHeaders),
          );
          return response;
        } catch (error) {
          captureResult(info, Date.now() - started, undefined, error);
          throw error;
        }
      };

      return () => {
        if (disposed) return;
        disposed = true;
        target.fetch = originalFetch;
      };
    },
  };
}
