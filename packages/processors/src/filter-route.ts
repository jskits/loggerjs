import {
  toLevelValue,
  withLogEventRoute,
  type EnabledLogLevelName,
  type LogEvent,
  type LogEventRoute,
  type LoggerLevel,
  type Processor,
  type ProcessorContext,
  type Tags,
} from "@loggerjs/core";

export type EventStringMatcher =
  | string
  | RegExp
  | ((value: string | undefined, event: LogEvent) => boolean);

export interface EventMatch {
  when?: (event: LogEvent, context: ProcessorContext) => boolean;
  logger?: EventStringMatcher | readonly EventStringMatcher[];
  type?: EventStringMatcher | readonly EventStringMatcher[];
  integration?: EventStringMatcher | readonly EventStringMatcher[];
  runtime?: EventStringMatcher | readonly EventStringMatcher[];
  levelName?: EnabledLogLevelName | readonly EnabledLogLevelName[];
  tags?: Tags;
  minLevel?: LoggerLevel;
  maxLevel?: LoggerLevel;
}

export type FilterAction = "keep" | "drop";
export type FilterPredicate = (event: LogEvent, context: ProcessorContext) => boolean;

export interface FilterRule extends EventMatch {
  action?: FilterAction;
  reason?: string;
}

export interface FilterOptions {
  rules: readonly FilterRule[];
  defaultAction?: FilterAction;
  onDrop?: (event: LogEvent, reason: string) => void;
}

export type FilterInput = FilterPredicate | readonly FilterRule[] | FilterOptions;

export interface RouteRule extends EventMatch, LogEventRoute {}

export interface RouteOptions {
  rules: readonly RouteRule[];
  defaultRoute?: LogEventRoute;
}

export type RouteInput = LogEventRoute | readonly RouteRule[] | RouteOptions;

function stringMatchers(
  matcher: EventStringMatcher | readonly EventStringMatcher[] | undefined,
): readonly EventStringMatcher[] {
  if (!matcher) return [];
  return Array.isArray(matcher) ? matcher : [matcher as EventStringMatcher];
}

function matchesString(
  matcher: EventStringMatcher | readonly EventStringMatcher[] | undefined,
  value: string | undefined,
  event: LogEvent,
): boolean {
  const matchers = stringMatchers(matcher);
  if (matchers.length === 0) return true;

  for (const item of matchers) {
    if (typeof item === "function" && item(value, event)) return true;
    if (item instanceof RegExp && item.test(value ?? "")) return true;
    if (typeof item === "string" && value === item) return true;
  }
  return false;
}

function matchesLevelName(
  expected: EnabledLogLevelName | readonly EnabledLogLevelName[] | undefined,
  actual: EnabledLogLevelName,
): boolean {
  if (!expected) return true;
  return Array.isArray(expected) ? expected.includes(actual) : expected === actual;
}

function matchesTags(expected: Tags | undefined, actual: Tags | undefined): boolean {
  if (!expected) return true;
  for (const [key, value] of Object.entries(expected)) {
    if (actual?.[key] !== value) return false;
  }
  return true;
}

function matchesLevelRange(event: LogEvent, match: EventMatch): boolean {
  if (match.minLevel !== undefined && event.level < toLevelValue(match.minLevel)) return false;
  if (match.maxLevel !== undefined && event.level > toLevelValue(match.maxLevel)) return false;
  return true;
}

function matchesEvent(event: LogEvent, context: ProcessorContext, match: EventMatch): boolean {
  return (
    (!match.when || match.when(event, context)) &&
    matchesString(match.logger, event.logger, event) &&
    matchesString(match.type, event.type, event) &&
    matchesString(match.integration, event.source?.integration, event) &&
    matchesString(match.runtime, event.source?.runtime, event) &&
    matchesLevelName(match.levelName, event.levelName) &&
    matchesTags(match.tags, event.tags) &&
    matchesLevelRange(event, match)
  );
}

function isFilterRuleArray(
  input: readonly FilterRule[] | FilterOptions,
): input is readonly FilterRule[] {
  return Array.isArray(input);
}

function normalizeFilterOptions(input: readonly FilterRule[] | FilterOptions): FilterOptions {
  return isFilterRuleArray(input) ? { rules: input } : input;
}

function reportDrop(options: FilterOptions, event: LogEvent, reason: string): false {
  options.onDrop?.(event, reason);
  return false;
}

export function filterProcessor(input: FilterInput): Processor {
  if (typeof input === "function") {
    return (event, context) => (input(event, context) ? event : false);
  }

  const options = normalizeFilterOptions(input);
  const defaultAction = options.defaultAction ?? "keep";

  return (event, context) => {
    for (const rule of options.rules) {
      if (!matchesEvent(event, context, rule)) continue;
      const action = rule.action ?? "drop";
      return action === "keep" ? event : reportDrop(options, event, rule.reason ?? "rule");
    }

    return defaultAction === "keep" ? event : reportDrop(options, event, "default");
  };
}

function hasRoute(route: LogEventRoute | undefined): route is LogEventRoute {
  return Boolean(route?.transports || route?.excludeTransports);
}

function routeFromRule(rule: RouteRule): LogEventRoute {
  return {
    transports: rule.transports,
    excludeTransports: rule.excludeTransports,
  };
}

function isRouteOptions(input: RouteInput): input is RouteOptions {
  return typeof input === "object" && input !== null && "rules" in input;
}

function isRouteRuleArray(input: RouteInput): input is readonly RouteRule[] {
  return Array.isArray(input);
}

export function routeProcessor(input: RouteInput): Processor {
  if (!isRouteRuleArray(input) && !isRouteOptions(input)) {
    return (event) => (hasRoute(input) ? withLogEventRoute(event, input) : event);
  }

  const rules = isRouteRuleArray(input) ? input : input.rules;
  const defaultRoute = isRouteRuleArray(input) ? undefined : input.defaultRoute;
  return (event, context) => {
    for (const rule of rules) {
      if (matchesEvent(event, context, rule)) {
        const route = routeFromRule(rule);
        return hasRoute(route) ? withLogEventRoute(event, route) : event;
      }
    }

    return hasRoute(defaultRoute) ? withLogEventRoute(event, defaultRoute) : event;
  };
}
