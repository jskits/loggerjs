import {
  incrementLoggerMetaCounter,
  toLevelValue,
  type LogEvent,
  type LoggerLevel,
  type Processor,
  type ProcessorContext,
  type Transport,
} from "@loggerjs/core";

export type FingersCrossedDropReason = "buffer-full" | "bucket-pruned";

export type FingersCrossedFlush = (
  events: readonly LogEvent[],
  context: ProcessorContext,
) => void | Promise<void>;

export interface FingersCrossedState {
  readonly key: string;
  readonly buffered: number;
  readonly activeUntilMs: number;
  readonly lastSeenMs: number;
}

export interface FingersCrossedProcessor extends Processor {
  states(): readonly FingersCrossedState[];
  reset(key?: string): void;
}

export interface FingersCrossedOptions {
  triggerLevel?: LoggerLevel;
  shouldTrigger?: (event: LogEvent) => boolean;
  bufferSize?: number;
  activationMs?: number;
  flushTo?: Transport | FingersCrossedFlush;
  includeTrigger?: boolean;
  passthroughTrigger?: boolean;
  passthroughAfterTrigger?: boolean;
  key?: (event: LogEvent) => string;
  maxBuckets?: number;
  onTrigger?: (event: LogEvent, buffered: readonly LogEvent[], key: string) => void;
  onDrop?: (event: LogEvent, reason: FingersCrossedDropReason, key: string) => void;
}

interface MutableState {
  key: string;
  buffer: LogEvent[];
  activeUntilMs: number;
  lastSeenMs: number;
}

const DEFAULT_KEY = "default";

function normalizeCount(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function normalizeBucketCount(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 1024;
  return Math.max(1, Math.floor(value));
}

function incrementBy(name: string, count: number): void {
  for (let index = 0; index < count; index += 1) incrementLoggerMetaCounter(name);
}

function snapshot(state: MutableState): FingersCrossedState {
  return {
    key: state.key,
    buffered: state.buffer.length,
    activeUntilMs: state.activeUntilMs,
    lastSeenMs: state.lastSeenMs,
  };
}

function isFlushFunction(target: Transport | FingersCrossedFlush): target is FingersCrossedFlush {
  return typeof target === "function";
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

async function flushToTarget(
  target: Transport | FingersCrossedFlush,
  events: readonly LogEvent[],
  context: ProcessorContext,
): Promise<void> {
  if (events.length === 0) return;
  if (isFlushFunction(target)) {
    await target(events, context);
    return;
  }

  const minLevel = target.minLevel === undefined ? undefined : toLevelValue(target.minLevel);
  const selected =
    minLevel === undefined ? [...events] : events.filter((event) => event.level >= minLevel);
  if (selected.length === 0) return;

  if (target.logBatch) {
    const result = target.logBatch(selected, context);
    if (isPromiseLike(result)) await result;
    return;
  }
  if (!target.log) return;
  for (const event of selected) {
    const result = target.log(event, context);
    if (isPromiseLike(result)) {
      // oxlint-disable-next-line no-await-in-loop -- Preserve buffered log order.
      await result;
    }
  }
}

function scheduleFlush(
  target: Transport | FingersCrossedFlush | undefined,
  events: readonly LogEvent[],
  context: ProcessorContext,
): void {
  if (!target || events.length === 0) return;
  const batch = [...events];
  incrementBy("processor.fingersCrossed.flushed", batch.length);
  void flushToTarget(target, batch, context).catch((error) => {
    context.reportInternalError(error, {
      phase: "processor",
      processor: "fingersCrossed",
    });
  });
}

export function fingersCrossedProcessor(
  options: FingersCrossedOptions = {},
): FingersCrossedProcessor {
  const triggerLevel = toLevelValue(options.triggerLevel ?? "error");
  const shouldTrigger = options.shouldTrigger ?? ((event: LogEvent) => event.level >= triggerLevel);
  const bufferSize = normalizeCount(options.bufferSize, 100);
  const maxBuckets = normalizeBucketCount(options.maxBuckets);
  const keyFor = options.key ?? (() => DEFAULT_KEY);
  const includeTrigger = options.includeTrigger ?? true;
  const passthroughTrigger = options.passthroughTrigger ?? !options.flushTo;
  const passthroughAfterTrigger = options.passthroughAfterTrigger ?? true;
  const activationMs = options.activationMs;
  const states = new Map<string, MutableState>();

  const drop = (event: LogEvent, reason: FingersCrossedDropReason, key: string) => {
    incrementLoggerMetaCounter("processor.fingersCrossed.dropped");
    incrementLoggerMetaCounter(`processor.fingersCrossed.dropped.${reason}`);
    options.onDrop?.(event, reason, key);
  };

  const getState = (key: string, now: number): MutableState => {
    let state = states.get(key);
    if (!state) {
      state = { key, buffer: [], activeUntilMs: 0, lastSeenMs: now };
      states.set(key, state);
    }
    state.lastSeenMs = now;

    while (states.size > maxBuckets) {
      let oldest: MutableState | undefined;
      for (const candidate of states.values()) {
        if (!oldest || candidate.lastSeenMs < oldest.lastSeenMs) oldest = candidate;
      }
      if (!oldest) break;
      for (const buffered of oldest.buffer) drop(buffered, "bucket-pruned", oldest.key);
      states.delete(oldest.key);
    }

    return state;
  };

  const processor = ((event, context) => {
    const now = context.now();
    const key = keyFor(event);
    const state = getState(key, now);

    if (state.activeUntilMs > 0 && state.activeUntilMs <= now) {
      state.activeUntilMs = 0;
    }

    if (state.activeUntilMs > now) {
      return passthroughAfterTrigger ? event : false;
    }

    if (shouldTrigger(event)) {
      const buffered = state.buffer.splice(0);
      state.activeUntilMs =
        activationMs === undefined ? Number.POSITIVE_INFINITY : now + Math.max(0, activationMs);
      incrementLoggerMetaCounter("processor.fingersCrossed.triggered");
      options.onTrigger?.(event, buffered, key);
      scheduleFlush(options.flushTo, includeTrigger ? [...buffered, event] : buffered, context);
      return passthroughTrigger ? event : false;
    }

    if (bufferSize === 0) return false;
    if (state.buffer.length >= bufferSize) {
      const dropped = state.buffer.shift();
      if (dropped) drop(dropped, "buffer-full", key);
    }
    state.buffer.push(event);
    incrementLoggerMetaCounter("processor.fingersCrossed.buffered");
    return false;
  }) as FingersCrossedProcessor;

  processor.states = () => [...states.values()].map(snapshot);
  processor.reset = (key?: string) => {
    if (key === undefined) {
      states.clear();
      return;
    }
    states.delete(key);
  };

  return processor;
}
