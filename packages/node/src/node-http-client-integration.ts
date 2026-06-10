import { createRequire } from "node:module";
import {
  type CaptureInput,
  type Integration,
  type IntegrationSetupContext,
  type LoggerLevel,
} from "@loggerjs/core";

export interface NodeHttpClientRequestLike {
  once?: (event: "response" | "error", listener: (...args: unknown[]) => void) => unknown;
  on?: (event: "response" | "error", listener: (...args: unknown[]) => void) => unknown;
  off?: (event: "response" | "error", listener: (...args: unknown[]) => void) => unknown;
  removeListener?: (event: "response" | "error", listener: (...args: unknown[]) => void) => unknown;
  end?: (...args: unknown[]) => unknown;
}

export interface NodeHttpIncomingMessageLike {
  statusCode?: number;
  headers?: Record<string, number | string | string[] | undefined>;
}

export type NodeHttpRequestFunction = (
  this: unknown,
  ...args: unknown[]
) => NodeHttpClientRequestLike;

export interface NodeHttpModuleLike {
  request?: NodeHttpRequestFunction;
  get?: NodeHttpRequestFunction;
}

export interface NodeHttpClientRequestInfo {
  protocol: "http:" | "https:" | string;
  method: string;
  url: string;
  requestHeaders?: Record<string, string | string[]>;
}

export interface NodeHttpClientIntegrationOptions {
  name?: string;
  minStatus?: number;
  captureAll?: boolean;
  captureSuccessful?: boolean;
  sampleRate?: number;
  random?: () => number;
  captureRequestHeaders?: readonly string[];
  captureResponseHeaders?: readonly string[];
  sanitizeUrl?: (url: string) => string;
  level?: (
    status: number | undefined,
    error: unknown,
    info: NodeHttpClientRequestInfo,
  ) => LoggerLevel;
  httpModule?: NodeHttpModuleLike | null;
  httpsModule?: NodeHttpModuleLike | null;
}

const requireBuiltin = createRequire(import.meta.url);
const defaultRandom = () => Math.random();

let cachedHttpModule: NodeHttpModuleLike | null | undefined;
let cachedHttpsModule: NodeHttpModuleLike | null | undefined;

function loadBuiltin(name: "node:http" | "node:https", fallback: "http" | "https") {
  try {
    return requireBuiltin(name) as NodeHttpModuleLike;
  } catch {
    try {
      return requireBuiltin(fallback) as NodeHttpModuleLike;
    } catch {
      return null;
    }
  }
}

function loadHttpModule() {
  if (cachedHttpModule !== undefined) return cachedHttpModule;
  cachedHttpModule = loadBuiltin("node:http", "http");
  return cachedHttpModule;
}

function loadHttpsModule() {
  if (cachedHttpsModule !== undefined) return cachedHttpsModule;
  cachedHttpsModule = loadBuiltin("node:https", "https");
  return cachedHttpsModule;
}

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

function isOptionsObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !isUrlLike(value);
}

function headerValue(value: unknown): string | string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.map(String);
  return String(value);
}

function pickHeaders(
  headers: unknown,
  names: readonly string[] | undefined,
): Record<string, string | string[]> | undefined {
  if (!names || names.length === 0 || !isOptionsObject(headers)) return undefined;
  const out: Record<string, string | string[]> = {};
  for (const name of names) {
    const lowerName = name.toLowerCase();
    const value = headerValue(headers[lowerName] ?? headers[name]);
    if (value !== undefined) out[lowerName] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function maybeUrl(value: unknown): URL | undefined {
  if (isUrlLike(value)) return value;
  if (typeof value !== "string") return undefined;
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function pathFromUrl(url: URL | undefined): string {
  if (!url) return "/";
  return `${url.pathname || "/"}${url.search}`;
}

function optionString(options: Record<string, unknown>, key: string): string | undefined {
  const value = options[key];
  if (value === undefined) return undefined;
  return String(value);
}

function requestInfo(
  args: readonly unknown[],
  defaultProtocol: "http:" | "https:",
  sanitizeUrl: (url: string) => string,
  captureRequestHeaders: readonly string[] | undefined,
): NodeHttpClientRequestInfo {
  const first = args[0];
  const second = args[1];
  const parsed = maybeUrl(first);
  const options = isOptionsObject(first) ? first : isOptionsObject(second) ? second : undefined;
  const protocol = optionString(options ?? {}, "protocol") ?? parsed?.protocol ?? defaultProtocol;
  const method = (optionString(options ?? {}, "method") ?? "GET").toUpperCase();
  const host =
    optionString(options ?? {}, "host") ?? optionString(options ?? {}, "hostname") ?? parsed?.host;
  const port = optionString(options ?? {}, "port");
  const path = optionString(options ?? {}, "path") ?? pathFromUrl(parsed);
  const requestHeaders = pickHeaders(options?.headers, captureRequestHeaders);
  const url =
    parsed?.href ?? (host ? `${protocol}//${host}${port ? `:${port}` : ""}${path}` : path);

  return {
    protocol,
    method,
    url: sanitizeUrl(url),
    requestHeaders,
  };
}

function listenOnce(
  request: NodeHttpClientRequestLike,
  event: "response" | "error",
  listener: (...args: unknown[]) => void,
) {
  let active = true;
  const wrapped = (...args: unknown[]) => {
    if (!active) return;
    active = false;
    cleanup();
    listener(...args);
  };
  const cleanup = () => {
    request.off?.(event, wrapped);
    request.removeListener?.(event, wrapped);
  };

  if (request.once) request.once(event, wrapped);
  else request.on?.(event, wrapped);
}

function statusMessage(status: number | undefined) {
  return status === undefined ? "unknown" : String(status);
}

export function nodeHttpClientIntegration(
  options: NodeHttpClientIntegrationOptions = {},
): Integration {
  const name = options.name ?? "node-http-client";
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
    name: "node-http-client",
    setup(api: IntegrationSetupContext) {
      const httpModule = options.httpModule === undefined ? loadHttpModule() : options.httpModule;
      const httpsModule =
        options.httpsModule === undefined ? loadHttpsModule() : options.httpsModule;
      const capture = api.guard((input: CaptureInput) => api.capture(input));
      const disposers: Array<() => void> = [];
      let disposed = false;

      const captureResult = (
        info: NodeHttpClientRequestInfo,
        status: number | undefined,
        error: unknown,
        responseHeaders?: Record<string, string | string[]>,
      ) => {
        if (disposed || !shouldCapture(status, error)) return;
        capture({
          level: levelFor(status, error, info),
          message: error
            ? `HTTP error ${info.method} ${info.url}`
            : `HTTP ${statusMessage(status)} ${info.method} ${info.url}`,
          error,
          props: {
            http: {
              kind: name,
              runtime: "node",
              direction: "outgoing",
              protocol: info.protocol,
              method: info.method,
              url: info.url,
              status,
              requestHeaders: info.requestHeaders,
              responseHeaders,
            },
          },
        });
      };

      const patchModule = (
        module: NodeHttpModuleLike | null,
        defaultProtocol: "http:" | "https:",
      ) => {
        if (!module?.request) return;
        const originalRequest = module.request;
        const originalGet = module.get;
        module.request = function patchedRequest(this: unknown, ...args: unknown[]) {
          const info = requestInfo(
            args,
            defaultProtocol,
            sanitizeUrl,
            options.captureRequestHeaders,
          );
          const request = originalRequest.apply(this, args);
          listenOnce(request, "response", (message) => {
            const response = message as NodeHttpIncomingMessageLike;
            captureResult(
              info,
              response.statusCode,
              undefined,
              pickHeaders(response.headers, options.captureResponseHeaders),
            );
          });
          listenOnce(request, "error", (error) => captureResult(info, undefined, error));
          return request;
        };

        if (originalGet) {
          module.get = function patchedGet(this: unknown, ...args: unknown[]) {
            const request = module.request?.apply(this, args) ?? originalGet.apply(this, args);
            request.end?.();
            return request;
          };
        }

        disposers.push(() => {
          module.request = originalRequest;
          if (originalGet) module.get = originalGet;
        });
      };

      patchModule(httpModule, "http:");
      patchModule(httpsModule, "https:");

      return () => {
        if (disposed) return;
        disposed = true;
        for (const dispose of disposers) dispose();
      };
    },
  };
}
