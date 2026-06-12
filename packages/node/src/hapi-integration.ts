import { withContext, type LoggerLevel, type LoggerLike, type LogData } from "@loggerjs/core";

export interface HapiRequestLike {
  method?: string;
  path?: string;
  url?: { pathname?: string };
  info?: { id?: string; received?: number; remoteAddress?: string };
  response?: { statusCode?: number } | { isBoom?: boolean; output?: { statusCode?: number } };
  app?: Record<string, unknown>;
}

export interface HapiToolkitLike {
  continue: unknown;
}

export interface HapiServerLike {
  ext: (
    event: "onRequest",
    handler: (request: HapiRequestLike, h: HapiToolkitLike) => unknown,
  ) => unknown;
  events?: {
    on?: (event: "response", handler: (request: HapiRequestLike) => void) => unknown;
  };
}

export interface HapiIntegrationOptions {
  minStatus?: number;
  captureAll?: boolean;
  bindContext?: boolean;
  getRequestId?: (request: HapiRequestLike) => string | undefined;
  context?: (request: HapiRequestLike) => Record<string, unknown> | undefined;
  level?: (status: number, request: HapiRequestLike) => LoggerLevel;
}

function responseStatus(response: HapiRequestLike["response"]): number {
  if (!response) return 200;
  if ("statusCode" in response && typeof response.statusCode === "number")
    return response.statusCode;
  if ("output" in response && typeof response.output?.statusCode === "number") {
    return response.output.statusCode;
  }
  return 200;
}

function levelFor(status: number): LoggerLevel {
  if (status >= 500) return "error";
  if (status >= 400) return "warn";
  return "info";
}

export function hapiIntegration(logger: LoggerLike, options: HapiIntegrationOptions = {}) {
  const minStatus = options.minStatus ?? 400;
  const captureAll = options.captureAll ?? false;
  const bindContext = options.bindContext ?? true;
  const getLevel = options.level ?? levelFor;

  return {
    name: "loggerjs-hapi",
    register(server: HapiServerLike) {
      server.ext("onRequest", (request, h) => {
        const method = (request.method ?? "GET").toUpperCase();
        const url = request.url?.pathname ?? request.path ?? "/";
        const requestId = options.getRequestId?.(request) ?? request.info?.id;
        const context = {
          httpMethod: method,
          httpUrl: url,
          requestId,
          ...options.context?.(request),
        };
        request.app = { ...request.app, loggerjsStartedAt: Date.now() };
        if (bindContext) return withContext(context, () => h.continue);
        return h.continue;
      });

      server.events?.on?.("response", (request) => {
        const status = responseStatus(request.response);
        if (!captureAll && status < minStatus) return;
        const method = (request.method ?? "GET").toUpperCase();
        const url = request.url?.pathname ?? request.path ?? "/";
        const requestId = options.getRequestId?.(request) ?? request.info?.id;
        const started = request.app?.loggerjsStartedAt as number | undefined;
        logger.log(getLevel(status, request), `Hapi ${status} ${method} ${url}`, {
          http: {
            framework: "hapi",
            kind: "hapi",
            method,
            url,
            status,
            durationMs: started ? Date.now() - started : undefined,
            requestId,
            remoteAddress: request.info?.remoteAddress,
          },
        } as LogData);
      });
    },
  };
}
