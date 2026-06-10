import { withContext, type LoggerLevel, type LoggerLike, type LogData } from "@loggerjs/core";

export interface FastifyRequestLike {
  id?: string;
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  routeOptions?: { url?: string };
  routerPath?: string;
  [key: string]: unknown;
}

export interface FastifyReplyLike {
  statusCode?: number;
  getHeader?: (name: string) => number | string | string[] | undefined;
  [key: string]: unknown;
}

export type FastifyDone = (error?: unknown) => void;
export type FastifyOnRequestHook = (
  request: FastifyRequestLike,
  reply: FastifyReplyLike,
  done: FastifyDone,
) => void;
export type FastifyOnResponseHook = (
  request: FastifyRequestLike,
  reply: FastifyReplyLike,
  done: FastifyDone,
) => void;
export type FastifyOnErrorHook = (
  request: FastifyRequestLike,
  reply: FastifyReplyLike,
  error: unknown,
  done: FastifyDone,
) => void;

export interface FastifyInstanceLike {
  addHook: (
    name: "onRequest" | "onResponse" | "onError",
    hook: FastifyOnRequestHook | FastifyOnResponseHook | FastifyOnErrorHook,
  ) => unknown;
}

export type FastifyPluginCallback = (
  instance: FastifyInstanceLike,
  options: unknown,
  done?: FastifyDone,
) => void;

export interface FastifyIntegrationOptions {
  name?: string;
  minStatus?: number;
  captureAll?: boolean;
  captureSuccessful?: boolean;
  sampleRate?: number;
  random?: () => number;
  bindContext?: boolean;
  captureRequestHeaders?: readonly string[];
  captureResponseHeaders?: readonly string[];
  sanitizeUrl?: (url: string) => string;
  getRequestId?: (request: FastifyRequestLike, reply: FastifyReplyLike) => string | undefined;
  getRoute?: (request: FastifyRequestLike) => string | undefined;
  context?: (
    request: FastifyRequestLike,
    reply: FastifyReplyLike,
  ) => Record<string, unknown> | undefined;
  level?: (
    status: number,
    request: FastifyRequestLike,
    reply: FastifyReplyLike,
    error: unknown,
  ) => LoggerLevel;
}

interface RequestState {
  started: number;
  error?: unknown;
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
  _request: FastifyRequestLike,
  _reply: FastifyReplyLike,
  error: unknown,
): LoggerLevel {
  if (error || status >= 500) return "error";
  if (status >= 400) return "warn";
  return "info";
}

function headerValue(value: number | string | string[] | undefined): string | string[] | undefined {
  if (typeof value === "number") return String(value);
  return value;
}

function pickRequestHeaders(
  request: FastifyRequestLike,
  names: readonly string[] | undefined,
): Record<string, string | string[]> | undefined {
  if (!names || names.length === 0 || !request.headers) return undefined;
  const out: Record<string, string | string[]> = {};
  for (const name of names) {
    const value = request.headers[name.toLowerCase()] ?? request.headers[name];
    if (value !== undefined) out[name.toLowerCase()] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function pickResponseHeaders(
  reply: FastifyReplyLike,
  names: readonly string[] | undefined,
): Record<string, string | string[]> | undefined {
  if (!names || names.length === 0 || !reply.getHeader) return undefined;
  const out: Record<string, string | string[]> = {};
  for (const name of names) {
    const value = headerValue(reply.getHeader(name));
    if (value !== undefined) out[name.toLowerCase()] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function defaultRoute(request: FastifyRequestLike): string | undefined {
  return request.routeOptions?.url ?? request.routerPath;
}

export function fastifyIntegration(
  logger: LoggerLike,
  options: FastifyIntegrationOptions = {},
): FastifyPluginCallback {
  const name = options.name ?? "fastify";
  const minStatus = options.minStatus ?? 400;
  const captureAll = options.captureAll ?? options.captureSuccessful ?? false;
  const sampleRate = options.sampleRate ?? 1;
  const random = options.random ?? defaultRandom;
  const sanitizeUrl = options.sanitizeUrl ?? defaultSanitizeUrl;
  const levelFor = options.level ?? defaultLevel;
  const routeFor = options.getRoute ?? defaultRoute;
  const bindContext = options.bindContext ?? true;
  const states = new WeakMap<FastifyRequestLike, RequestState>();

  const shouldCapture = (status: number, error: unknown) => {
    if (error) return true;
    if (status >= minStatus) return true;
    if (!captureAll) return false;
    return sampleRate >= 1 || random() < sampleRate;
  };

  return (instance, _pluginOptions, done) => {
    instance.addHook(
      "onRequest",
      (request: FastifyRequestLike, reply: FastifyReplyLike, next: FastifyDone) => {
        const method = (request.method ?? "GET").toUpperCase();
        const url = sanitizeUrl(request.url ?? "/");
        const requestId = options.getRequestId?.(request, reply) ?? request.id;
        states.set(request, { started: Date.now() });
        const context = {
          httpMethod: method,
          httpUrl: url,
          requestId,
          ...options.context?.(request, reply),
        };
        if (bindContext) {
          withContext(context, () => next());
          return;
        }
        next();
      },
    );

    instance.addHook(
      "onError",
      (
        request: FastifyRequestLike,
        _reply: FastifyReplyLike,
        error: unknown,
        next: FastifyDone,
      ) => {
        const state = states.get(request);
        if (state) state.error = error;
        else states.set(request, { started: Date.now(), error });
        next();
      },
    );

    instance.addHook(
      "onResponse",
      (request: FastifyRequestLike, reply: FastifyReplyLike, next: FastifyDone) => {
        const state = states.get(request) ?? { started: Date.now() };
        states.delete(request);
        const status = reply.statusCode ?? 0;
        const error = state.error;
        if (!shouldCapture(status, error)) {
          next();
          return;
        }

        const method = (request.method ?? "GET").toUpperCase();
        const url = sanitizeUrl(request.url ?? "/");
        const requestId = options.getRequestId?.(request, reply) ?? request.id;
        const http: Record<string, unknown> = {
          kind: name,
          framework: "fastify",
          method,
          url,
          route: routeFor(request),
          status,
          durationMs: Date.now() - state.started,
          requestId,
          remoteAddress: request.ip,
          requestHeaders: pickRequestHeaders(request, options.captureRequestHeaders),
          responseHeaders: pickResponseHeaders(reply, options.captureResponseHeaders),
        };
        const data: Record<string, unknown> = { http };
        if (error) data.error = error;
        logger.log(levelFor(status, request, reply, error), `Fastify ${status} ${method} ${url}`, {
          ...data,
        } as LogData);
        next();
      },
    );

    done?.();
  };
}
