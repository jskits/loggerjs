import {
  normalizeValue,
  withContext,
  type LoggerLevel,
  type LoggerLike,
  type LogData,
} from "@loggerjs/core";

export type ServerlessCallback<TResult> = (error?: unknown, result?: TResult) => void;

export type ServerlessHandler<TEvent, TContext, TResult> = (
  event: TEvent,
  context: TContext,
  callback?: ServerlessCallback<TResult>,
) => TResult | Promise<TResult> | void;

export interface ServerlessContextLike {
  awsRequestId?: string;
  functionName?: string;
  functionVersion?: string;
  invokedFunctionArn?: string;
  [key: string]: unknown;
}

export interface ServerlessEventLike {
  httpMethod?: string;
  path?: string;
  rawPath?: string;
  routeKey?: string;
  headers?: Record<string, string | undefined>;
  requestContext?: {
    requestId?: string;
    http?: {
      method?: string;
      path?: string;
    };
    routeKey?: string;
  };
  [key: string]: unknown;
}

export interface ServerlessInvocationInfo<TEvent, TContext> {
  event: TEvent;
  context: TContext;
  requestId?: string;
  operation?: string;
}

export interface ServerlessIntegrationOptions<TEvent, TContext, TResult> {
  name?: string;
  platform?: string;
  captureSuccessful?: boolean;
  captureAll?: boolean;
  sampleRate?: number;
  random?: () => number;
  captureEvent?: boolean;
  captureResult?: boolean;
  bindContext?: boolean;
  getRequestId?: (event: TEvent, context: TContext) => string | undefined;
  getOperation?: (event: TEvent, context: TContext) => string | undefined;
  level?: (
    error: unknown,
    durationMs: number,
    info: ServerlessInvocationInfo<TEvent, TContext>,
  ) => LoggerLevel;
  normalizeEvent?: (event: TEvent) => unknown;
  normalizeResult?: (result: TResult) => unknown;
}

const defaultRandom = () => Math.random();
let coldStart = true;

function isPromiseLike<TResult>(value: unknown): value is PromiseLike<TResult> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function defaultLevel(error: unknown): LoggerLevel {
  return error ? "error" : "info";
}

function defaultRequestId(event: unknown, context: unknown): string | undefined {
  const ctx = context as ServerlessContextLike | undefined;
  const evt = event as ServerlessEventLike | undefined;
  return (
    ctx?.awsRequestId ??
    evt?.requestContext?.requestId ??
    evt?.headers?.["x-request-id"] ??
    evt?.headers?.["X-Request-Id"]
  );
}

function defaultOperation(event: unknown, context: unknown): string | undefined {
  const ctx = context as ServerlessContextLike | undefined;
  const evt = event as ServerlessEventLike | undefined;
  return (
    evt?.routeKey ??
    evt?.requestContext?.routeKey ??
    (evt?.requestContext?.http?.method && evt.requestContext.http.path
      ? `${evt.requestContext.http.method} ${evt.requestContext.http.path}`
      : undefined) ??
    (evt?.httpMethod && (evt.rawPath ?? evt.path)
      ? `${evt.httpMethod} ${evt.rawPath ?? evt.path}`
      : undefined) ??
    ctx?.functionName
  );
}

function normalizeUnknown(value: unknown) {
  return normalizeValue(value, { maxDepth: 5, maxObjectKeys: 120 });
}

export function serverlessIntegration<TEvent, TContext, TResult>(
  logger: LoggerLike,
  handler: ServerlessHandler<TEvent, TContext, TResult>,
  options: ServerlessIntegrationOptions<TEvent, TContext, TResult> = {},
): ServerlessHandler<TEvent, TContext, TResult> {
  const name = options.name ?? "serverless";
  const platform = options.platform ?? "serverless";
  const captureSuccessful = options.captureSuccessful ?? options.captureAll ?? true;
  const sampleRate = options.sampleRate ?? 1;
  const random = options.random ?? defaultRandom;
  const bindContext = options.bindContext ?? true;
  const levelFor = options.level ?? defaultLevel;

  return (event, context, callback) => {
    const started = Date.now();
    const currentColdStart = coldStart;
    coldStart = false;
    const requestId = options.getRequestId?.(event, context) ?? defaultRequestId(event, context);
    const operation = options.getOperation?.(event, context) ?? defaultOperation(event, context);
    let captured = false;

    const shouldCapture = (error: unknown) => {
      if (error) return true;
      if (!captureSuccessful) return false;
      return sampleRate >= 1 || random() < sampleRate;
    };

    const capture = (error: unknown, result?: TResult) => {
      if (captured || !shouldCapture(error)) return;
      captured = true;
      const durationMs = Date.now() - started;
      const info: ServerlessInvocationInfo<TEvent, TContext> = {
        context,
        event,
        operation,
        requestId,
      };
      logger.log(levelFor(error, durationMs, info), `Serverless ${operation ?? name}`, {
        error,
        serverless: {
          kind: name,
          platform,
          operation,
          requestId,
          coldStart: currentColdStart,
          durationMs,
          event: options.captureEvent
            ? (options.normalizeEvent?.(event) ?? normalizeUnknown(event))
            : undefined,
          result:
            options.captureResult && result !== undefined
              ? (options.normalizeResult?.(result) ?? normalizeUnknown(result))
              : undefined,
        },
      } as LogData);
    };

    const wrappedCallback = callback
      ? (error?: unknown, result?: TResult) => {
          capture(error, result);
          callback(error, result);
        }
      : undefined;

    const invoke = () => {
      try {
        const result = handler(event, context, wrappedCallback);
        if (isPromiseLike<TResult>(result)) {
          return result.then(
            (value) => {
              capture(undefined, value);
              return value;
            },
            (error) => {
              capture(error);
              throw error;
            },
          );
        }
        if (result !== undefined || !wrappedCallback) capture(undefined, result as TResult);
        return result;
      } catch (error) {
        capture(error);
        throw error;
      }
    };

    if (!bindContext) return invoke();
    return withContext(
      {
        functionName: (context as ServerlessContextLike | undefined)?.functionName,
        requestId,
        serverlessPlatform: platform,
      },
      invoke,
    );
  };
}
