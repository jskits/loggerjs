import { withContext, type LoggerLevel, type LoggerLike, type LogData } from "@loggerjs/core";

export interface ExpressRequestLike {
  method?: string;
  originalUrl?: string;
  url?: string;
  path?: string;
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  route?: { path?: string };
  socket?: { remoteAddress?: string };
  [key: string]: unknown;
}

export interface ExpressResponseLike {
  statusCode?: number;
  writableEnded?: boolean;
  headersSent?: boolean;
  getHeader?: (name: string) => number | string | string[] | undefined;
  once?: (event: "finish" | "close", listener: () => void) => unknown;
  on?: (event: "finish" | "close", listener: () => void) => unknown;
  off?: (event: "finish" | "close", listener: () => void) => unknown;
  removeListener?: (event: "finish" | "close", listener: () => void) => unknown;
}

export type ExpressNextFunction = (error?: unknown) => void;
export type ExpressRequestHandler = (
  req: ExpressRequestLike,
  res: ExpressResponseLike,
  next: ExpressNextFunction,
) => void;

export interface ExpressIntegrationOptions {
  name?: string;
  minStatus?: number;
  captureAll?: boolean;
  captureSuccessful?: boolean;
  captureAborted?: boolean;
  sampleRate?: number;
  random?: () => number;
  bindContext?: boolean;
  captureRequestHeaders?: readonly string[];
  captureResponseHeaders?: readonly string[];
  sanitizeUrl?: (url: string) => string;
  getRequestId?: (req: ExpressRequestLike, res: ExpressResponseLike) => string | undefined;
  getRoute?: (req: ExpressRequestLike) => string | undefined;
  context?: (
    req: ExpressRequestLike,
    res: ExpressResponseLike,
  ) => Record<string, unknown> | undefined;
  level?: (
    status: number,
    req: ExpressRequestLike,
    res: ExpressResponseLike,
    aborted: boolean,
  ) => LoggerLevel;
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

function defaultLevel(
  status: number,
  _req: ExpressRequestLike,
  _res: ExpressResponseLike,
  aborted: boolean,
): LoggerLevel {
  if (aborted) return "warn";
  if (status >= 500) return "error";
  if (status >= 400) return "warn";
  return "info";
}

function requestUrl(req: ExpressRequestLike): string {
  return req.originalUrl ?? req.url ?? req.path ?? "/";
}

function headerValue(value: number | string | string[] | undefined): string | string[] | undefined {
  if (typeof value === "number") return String(value);
  return value;
}

function pickRequestHeaders(
  req: ExpressRequestLike,
  names: readonly string[] | undefined,
): Record<string, string | string[]> | undefined {
  if (!names || names.length === 0 || !req.headers) return undefined;
  const out: Record<string, string | string[]> = {};
  for (const name of names) {
    const value = req.headers[name.toLowerCase()] ?? req.headers[name];
    if (value !== undefined) out[name.toLowerCase()] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function pickResponseHeaders(
  res: ExpressResponseLike,
  names: readonly string[] | undefined,
): Record<string, string | string[]> | undefined {
  if (!names || names.length === 0 || !res.getHeader) return undefined;
  const out: Record<string, string | string[]> = {};
  for (const name of names) {
    const value = headerValue(res.getHeader(name));
    if (value !== undefined) out[name.toLowerCase()] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function defaultRoute(req: ExpressRequestLike): string | undefined {
  const path = req.route?.path;
  return typeof path === "string" ? path : undefined;
}

function removeListener(res: ExpressResponseLike, event: "finish" | "close", listener: () => void) {
  if (res.off) {
    res.off(event, listener);
    return;
  }
  res.removeListener?.(event, listener);
}

function onResponseDone(res: ExpressResponseLike, event: "finish" | "close", listener: () => void) {
  if (res.once) {
    res.once(event, listener);
    return;
  }
  res.on?.(event, listener);
}

export function expressIntegration(
  logger: LoggerLike,
  options: ExpressIntegrationOptions = {},
): ExpressRequestHandler {
  const name = options.name ?? "express";
  const minStatus = options.minStatus ?? 400;
  const captureAll = options.captureAll ?? options.captureSuccessful ?? false;
  const captureAborted = options.captureAborted ?? true;
  const sampleRate = options.sampleRate ?? 1;
  const random = options.random ?? defaultRandom;
  const sanitizeUrl = options.sanitizeUrl ?? defaultSanitizeUrl;
  const levelFor = options.level ?? defaultLevel;
  const routeFor = options.getRoute ?? defaultRoute;
  const bindContext = options.bindContext ?? true;

  return (req, res, next) => {
    const started = Date.now();
    const method = (req.method ?? "GET").toUpperCase();
    const url = sanitizeUrl(requestUrl(req));
    const requestId = options.getRequestId?.(req, res);
    let completed = false;

    const context = {
      httpMethod: method,
      httpUrl: url,
      requestId,
      ...options.context?.(req, res),
    };

    const shouldCapture = (status: number, aborted: boolean) => {
      if (aborted && captureAborted) return true;
      if (status >= minStatus) return true;
      if (!captureAll) return false;
      return sampleRate >= 1 || random() < sampleRate;
    };

    const cleanup = () => {
      removeListener(res, "finish", onFinish);
      removeListener(res, "close", onClose);
    };

    const logRequest = (event: "finish" | "close") => {
      if (completed) return;
      completed = true;
      cleanup();
      const status = res.statusCode ?? 0;
      const aborted = event === "close" && res.writableEnded !== true;
      if (!shouldCapture(status, aborted)) return;
      const http: Record<string, unknown> = {
        kind: name,
        framework: "express",
        method,
        url,
        route: routeFor(req),
        status,
        durationMs: Date.now() - started,
        aborted,
        requestId,
        remoteAddress: req.ip ?? req.socket?.remoteAddress,
        requestHeaders: pickRequestHeaders(req, options.captureRequestHeaders),
        responseHeaders: pickResponseHeaders(res, options.captureResponseHeaders),
      };
      logger.log(levelFor(status, req, res, aborted), `Express ${status} ${method} ${url}`, {
        http,
      } as LogData);
    };

    const onFinish = () => logRequest("finish");
    const onClose = () => logRequest("close");
    onResponseDone(res, "finish", onFinish);
    onResponseDone(res, "close", onClose);

    if (bindContext) {
      withContext(context, () => next());
      return;
    }
    next();
  };
}
