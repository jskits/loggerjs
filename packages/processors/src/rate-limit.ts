import {
  incrementLoggerMetaCounter,
  type EnabledLogLevelName,
  type LogEvent,
  type Processor,
} from "@loggerjs/core";

export interface RateLimitBucket {
  readonly key: string;
  readonly tokens: number;
  readonly lastRefillMs: number;
}

export interface RateLimitProcessor extends Processor {
  buckets(): readonly RateLimitBucket[];
}

export interface RateLimitOptions {
  capacity?: number;
  refillPerSecond?: number;
  key?: (event: LogEvent) => string;
  exemptLevels?: readonly EnabledLogLevelName[];
  maxBuckets?: number;
  onDrop?: (event: LogEvent, key: string) => void;
}

interface MutableBucket {
  key: string;
  tokens: number;
  lastRefillMs: number;
  lastSeenMs: number;
}

const DEFAULT_EXEMPT_LEVELS = new Set<EnabledLogLevelName>(["error", "fatal"]);

function defaultKey(event: LogEvent): string {
  return `${event.logger}:${event.levelName}:${event.source?.integration ?? event.type ?? "manual"}`;
}

function normalizePositive(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

function normalizeNonNegative(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return fallback;
  return value;
}

function snapshot(bucket: MutableBucket): RateLimitBucket {
  return {
    key: bucket.key,
    tokens: bucket.tokens,
    lastRefillMs: bucket.lastRefillMs,
  };
}

export function rateLimitProcessor(options: RateLimitOptions = {}): RateLimitProcessor {
  const capacity = normalizePositive(options.capacity, 100);
  const refillPerSecond = normalizeNonNegative(options.refillPerSecond, capacity);
  const maxBuckets = Math.max(1, Math.floor(options.maxBuckets ?? 10_000));
  const key = options.key ?? defaultKey;
  const exemptLevels = new Set(options.exemptLevels ?? DEFAULT_EXEMPT_LEVELS);
  const buckets = new Map<string, MutableBucket>();

  const prune = () => {
    while (buckets.size > maxBuckets) {
      let oldest: MutableBucket | undefined;
      for (const bucket of buckets.values()) {
        if (!oldest || bucket.lastSeenMs < oldest.lastSeenMs) oldest = bucket;
      }
      if (!oldest) return;
      buckets.delete(oldest.key);
    }
  };

  const processor = ((event, context) => {
    if (exemptLevels.has(event.levelName)) return event;

    const now = context.now();
    const bucketKey = key(event);
    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      bucket = {
        key: bucketKey,
        tokens: capacity,
        lastRefillMs: now,
        lastSeenMs: now,
      };
      buckets.set(bucketKey, bucket);
      prune();
    }

    const elapsedSeconds = Math.max(0, (now - bucket.lastRefillMs) / 1000);
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSeconds * refillPerSecond);
    bucket.lastRefillMs = now;
    bucket.lastSeenMs = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return event;
    }

    incrementLoggerMetaCounter("processor.rateLimit.dropped");
    incrementLoggerMetaCounter(`processor.rateLimit.dropped.${event.levelName}`);
    options.onDrop?.(event, bucketKey);
    return false;
  }) as RateLimitProcessor;

  processor.buckets = () => [...buckets.values()].map(snapshot);

  return processor;
}
