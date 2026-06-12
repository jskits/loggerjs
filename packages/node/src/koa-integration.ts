import { withContext, type LoggerLevel, type LoggerLike, type LogData } from "@loggerjs/core";

export interface KoaContextLike {
  method?: string;
  originalUrl?: string;
  url?: string;
  path?: string;
  status?: number;
  ip?: string;
  state?: Record<string, unknown>;
  request?: { headers?: Record<string, string | string[] | undefined> };
}

export type KoaNext = () => Promise<unknown>;
export type KoaMiddleware = (ctx: KoaContextLike, next: KoaNext) => Promise<void>;

export interface KoaIntegrationOptions {
  minStatus?: number;
  captureAll?: boolean;
  bindContext?: boolean;
  sanitizeUrl?: (url: string) => string;
  getRequestId?: (ctx: KoaContextLike) => string | undefined;
  context?: (ctx: KoaContextLike) => Record<string, unknown> | undefined;
  level?: (status: number, ctx: KoaContextLike, error: unknown) => LoggerLevel;
}

function sanitizeUrl(url: string): string {
  return url.split(/[?#]/, 1)[0] || "/";
}

function levelFor(status: number, _ctx: KoaContextLike, error: unknown): LoggerLevel {
  if (error || status >= 500) return "error";
  if (status >= 400) return "warn";
  return "info";
}

export function koaIntegration(
  logger: LoggerLike,
  options: KoaIntegrationOptions = {},
): KoaMiddleware {
  const minStatus = options.minStatus ?? 400;
  const captureAll = options.captureAll ?? false;
  const bindContext = options.bindContext ?? true;
  const sanitize = options.sanitizeUrl ?? sanitizeUrl;
  const getLevel = options.level ?? levelFor;

  return async (ctx, next) => {
    const started = Date.now();
    const method = (ctx.method ?? "GET").toUpperCase();
    const url = sanitize(ctx.originalUrl ?? ctx.url ?? ctx.path ?? "/");
    const requestId = options.getRequestId?.(ctx) ?? (ctx.state?.requestId as string | undefined);
    const context = { httpMethod: method, httpUrl: url, requestId, ...options.context?.(ctx) };
    let error: unknown;
    try {
      if (bindContext) await withContext(context, next);
      else await next();
    } catch (caught) {
      error = caught;
      throw caught;
    } finally {
      const status = ctx.status ?? (error ? 500 : 200);
      if (error || captureAll || status >= minStatus) {
        logger.log(getLevel(status, ctx, error), `Koa ${status} ${method} ${url}`, {
          http: {
            framework: "koa",
            kind: "koa",
            method,
            url,
            status,
            durationMs: Date.now() - started,
            requestId,
            remoteAddress: ctx.ip,
          },
          error,
        } as LogData);
      }
    }
  };
}
