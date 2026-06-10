import type { LogEvent } from "./types";

export const LOGGERJS_ROUTE = "__loggerjsRoute" as const;

export interface LogEventRoute {
  transports?: readonly string[];
  excludeTransports?: readonly string[];
}

export type RoutableLogEvent = LogEvent & {
  [LOGGERJS_ROUTE]?: LogEventRoute;
};

function mergeUnique(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): readonly string[] | undefined {
  if (!left) return right;
  if (!right) return left;
  return [...new Set([...left, ...right])];
}

export function getLogEventRoute(event: LogEvent): LogEventRoute | undefined {
  return (event as RoutableLogEvent)[LOGGERJS_ROUTE];
}

export function withLogEventRoute(event: LogEvent, route: LogEventRoute): LogEvent {
  const current = getLogEventRoute(event);
  const nextRoute: LogEventRoute = {
    transports: mergeUnique(current?.transports, route.transports),
    excludeTransports: mergeUnique(current?.excludeTransports, route.excludeTransports),
  };

  const next = { ...event } as RoutableLogEvent;
  Object.defineProperty(next, LOGGERJS_ROUTE, {
    configurable: true,
    enumerable: false,
    value: nextRoute,
  });
  return next;
}
