import {
  incrementLoggerMetaCounter,
  type EnabledLogLevelName,
  type LogEvent,
  type Processor,
  type ProcessorContext,
} from "@loggerjs/core";

export interface DynamicSamplerStats {
  readonly key: string;
  readonly seen: number;
  readonly kept: number;
  readonly dropped: number;
  readonly lastSeenMs: number;
}

export interface DynamicSamplerDecisionContext extends DynamicSamplerStats {
  readonly now: number;
}

export type DynamicSampleRate =
  | number
  | ((event: LogEvent, state: DynamicSamplerDecisionContext) => number);

export interface DynamicSamplerRule {
  rate: DynamicSampleRate;
  when?: (event: LogEvent, context: ProcessorContext) => boolean;
  key?: (event: LogEvent) => string;
  stickyBy?: (event: LogEvent) => string | undefined;
}

export interface DynamicSamplerProcessor extends Processor {
  stats(): readonly DynamicSamplerStats[];
  reset(key?: string): void;
}

export interface DynamicSamplerOptions {
  defaultRate?: DynamicSampleRate;
  rules?: readonly DynamicSamplerRule[];
  key?: (event: LogEvent) => string;
  stickyBy?: (event: LogEvent) => string | undefined;
  random?: () => number;
  exemptLevels?: readonly EnabledLogLevelName[];
  maxKeys?: number;
  onDrop?: (event: LogEvent, key: string, rate: number) => void;
}

interface MutableStats {
  key: string;
  seen: number;
  kept: number;
  dropped: number;
  lastSeenMs: number;
}

const DEFAULT_EXEMPT_LEVELS = new Set<EnabledLogLevelName>(["error", "fatal"]);

function defaultKey(event: LogEvent): string {
  return event.trace?.traceId ?? `${event.logger}:${event.levelName}:${event.type ?? "manual"}`;
}

function clampRate(rate: number): number {
  if (!Number.isFinite(rate) || Number.isNaN(rate)) return 1;
  return Math.max(0, Math.min(1, rate));
}

function hashRatio(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0x100000000;
}

function snapshot(stats: MutableStats): DynamicSamplerStats {
  return {
    key: stats.key,
    seen: stats.seen,
    kept: stats.kept,
    dropped: stats.dropped,
    lastSeenMs: stats.lastSeenMs,
  };
}

function decisionContext(stats: MutableStats, now: number): DynamicSamplerDecisionContext {
  return { ...snapshot(stats), now };
}

function resolveRule(
  event: LogEvent,
  context: ProcessorContext,
  options: DynamicSamplerOptions,
): DynamicSamplerRule {
  const rule = options.rules?.find((item) => !item.when || item.when(event, context));
  return {
    rate: rule?.rate ?? options.defaultRate ?? 1,
    key: rule?.key ?? options.key ?? defaultKey,
    stickyBy: rule?.stickyBy ?? options.stickyBy,
  };
}

function prune(statsByKey: Map<string, MutableStats>, maxKeys: number): void {
  while (statsByKey.size > maxKeys) {
    let oldest: MutableStats | undefined;
    for (const item of statsByKey.values()) {
      if (!oldest || item.lastSeenMs < oldest.lastSeenMs) oldest = item;
    }
    if (!oldest) return;
    statsByKey.delete(oldest.key);
  }
}

function shouldKeep(
  event: LogEvent,
  rule: DynamicSamplerRule,
  rate: number,
  random: () => number,
): boolean {
  if (rate >= 1) return true;
  if (rate <= 0) return false;

  const stickyKey = rule.stickyBy?.(event);
  return (stickyKey ? hashRatio(stickyKey) : random()) < rate;
}

export function dynamicSamplerProcessor(
  options: DynamicSamplerOptions = {},
): DynamicSamplerProcessor {
  const random = options.random ?? Math.random;
  const exemptLevels = new Set(options.exemptLevels ?? DEFAULT_EXEMPT_LEVELS);
  const maxKeys = Math.max(1, Math.floor(options.maxKeys ?? 10_000));
  const statsByKey = new Map<string, MutableStats>();

  const processor = ((event, context) => {
    if (exemptLevels.has(event.levelName)) return event;

    const now = context.now();
    const rule = resolveRule(event, context, options);
    const key = (rule.key ?? defaultKey)(event);
    let stats = statsByKey.get(key);
    if (!stats) {
      stats = { key, seen: 0, kept: 0, dropped: 0, lastSeenMs: now };
      statsByKey.set(key, stats);
      prune(statsByKey, maxKeys);
    }

    stats.seen += 1;
    stats.lastSeenMs = now;

    const rateValue =
      typeof rule.rate === "function" ? rule.rate(event, decisionContext(stats, now)) : rule.rate;
    const rate = clampRate(rateValue);

    if (shouldKeep(event, rule, rate, random)) {
      stats.kept += 1;
      return event;
    }

    stats.dropped += 1;
    incrementLoggerMetaCounter("processor.dynamicSampler.dropped");
    incrementLoggerMetaCounter(`processor.dynamicSampler.dropped.${event.levelName}`);
    options.onDrop?.(event, key, rate);
    return false;
  }) as DynamicSamplerProcessor;

  processor.stats = () => [...statsByKey.values()].map(snapshot);
  processor.reset = (key?: string) => {
    if (key) statsByKey.delete(key);
    else statsByKey.clear();
  };

  return processor;
}
