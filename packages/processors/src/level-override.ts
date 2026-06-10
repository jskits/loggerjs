import {
  toLevelName,
  toLevelValue,
  type EnabledLogLevelName,
  type LogEvent,
  type LoggerLevel,
  type Processor,
  type ProcessorContext,
  type Tags,
} from "@loggerjs/core";

export type LevelOverrideStringMatcher =
  | string
  | RegExp
  | ((value: string | undefined, event: LogEvent) => boolean);

export type LevelOverrideValue =
  | LoggerLevel
  | false
  | undefined
  | ((event: LogEvent, context: ProcessorContext) => LoggerLevel | false | void);

export interface LevelOverrideRule {
  level: LevelOverrideValue;
  when?: (event: LogEvent, context: ProcessorContext) => boolean;
  logger?: LevelOverrideStringMatcher | readonly LevelOverrideStringMatcher[];
  type?: LevelOverrideStringMatcher | readonly LevelOverrideStringMatcher[];
  integration?: LevelOverrideStringMatcher | readonly LevelOverrideStringMatcher[];
  runtime?: LevelOverrideStringMatcher | readonly LevelOverrideStringMatcher[];
  tags?: Tags;
  minLevel?: LoggerLevel;
  maxLevel?: LoggerLevel;
}

export interface LevelOverrideOptions {
  rules: readonly LevelOverrideRule[];
}

export type LevelOverrideInput =
  | LevelOverrideValue
  | readonly LevelOverrideRule[]
  | LevelOverrideOptions;

function asMatchers(
  matcher: LevelOverrideStringMatcher | readonly LevelOverrideStringMatcher[] | undefined,
): readonly LevelOverrideStringMatcher[] {
  if (!matcher) return [];
  return Array.isArray(matcher) ? matcher : [matcher as LevelOverrideStringMatcher];
}

function matchOne(
  matcher: LevelOverrideStringMatcher,
  value: string | undefined,
  event: LogEvent,
): boolean {
  if (typeof matcher === "function") return matcher(value, event);
  if (matcher instanceof RegExp) return matcher.test(value ?? "");
  return value === matcher;
}

function matchString(
  matcher: LevelOverrideStringMatcher | readonly LevelOverrideStringMatcher[] | undefined,
  value: string | undefined,
  event: LogEvent,
): boolean {
  const matchers = asMatchers(matcher);
  if (matchers.length === 0) return true;
  return matchers.some((item) => matchOne(item, value, event));
}

function matchTags(expected: Tags | undefined, actual: Tags | undefined): boolean {
  if (!expected) return true;
  for (const [key, value] of Object.entries(expected)) {
    if (actual?.[key] !== value) return false;
  }
  return true;
}

function matchLevelRange(event: LogEvent, rule: LevelOverrideRule): boolean {
  if (rule.minLevel !== undefined && event.level < toLevelValue(rule.minLevel)) return false;
  if (rule.maxLevel !== undefined && event.level > toLevelValue(rule.maxLevel)) return false;
  return true;
}

function matchesRule(event: LogEvent, context: ProcessorContext, rule: LevelOverrideRule): boolean {
  return (
    (!rule.when || rule.when(event, context)) &&
    matchString(rule.logger, event.logger, event) &&
    matchString(rule.type, event.type, event) &&
    matchString(rule.integration, event.source?.integration, event) &&
    matchString(rule.runtime, event.source?.runtime, event) &&
    matchTags(rule.tags, event.tags) &&
    matchLevelRange(event, rule)
  );
}

function resolveLevel(
  value: LevelOverrideValue,
  event: LogEvent,
  context: ProcessorContext,
): LoggerLevel | false | undefined {
  if (typeof value === "function") {
    const level = value(event, context);
    return level === undefined ? undefined : level;
  }
  return value;
}

function applyLevel(event: LogEvent, level: LoggerLevel | false | undefined): LogEvent | false {
  if (level === undefined) return event;
  if (level === false || level === "silent") return false;

  const nextLevel = toLevelValue(level, event.level);
  if (!Number.isFinite(nextLevel)) return false;

  const nextLevelName: EnabledLogLevelName = toLevelName(nextLevel);
  if (nextLevel === event.level && nextLevelName === event.levelName) return event;
  return { ...event, level: nextLevel, levelName: nextLevelName };
}

function isOptions(input: LevelOverrideInput): input is LevelOverrideOptions {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function isRuleArray(input: LevelOverrideInput): input is readonly LevelOverrideRule[] {
  return Array.isArray(input);
}

export function levelOverrideProcessor(input: LevelOverrideInput): Processor {
  if (!isRuleArray(input) && !isOptions(input)) {
    return (event, context) => applyLevel(event, resolveLevel(input, event, context));
  }

  const rules = isRuleArray(input) ? input : input.rules;
  return (event, context) => {
    for (const rule of rules) {
      if (matchesRule(event, context, rule)) {
        return applyLevel(event, resolveLevel(rule.level, event, context));
      }
    }
    return event;
  };
}
