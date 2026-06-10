import { toLevelValue, type LogEvent, type LoggerLevel, type Processor } from "@loggerjs/core";

export interface Breadcrumb {
  time: number;
  levelName: LogEvent["levelName"];
  logger: string;
  message: string;
  type?: string;
  tags?: LogEvent["tags"];
  source?: LogEvent["source"];
}

export interface BreadcrumbBufferState {
  readonly key: string;
  readonly buffered: number;
  readonly lastSeenMs: number;
}

export interface BreadcrumbBufferProcessor extends Processor {
  states(): readonly BreadcrumbBufferState[];
  reset(key?: string): void;
}

export interface BreadcrumbBufferOptions<TBreadcrumb = Breadcrumb> {
  triggerLevel?: LoggerLevel;
  shouldAttach?: (event: LogEvent) => boolean;
  shouldBuffer?: (event: LogEvent) => boolean;
  bufferSize?: number;
  maxBuckets?: number;
  key?: (event: LogEvent) => string;
  map?: (event: LogEvent) => TBreadcrumb;
  target?: "context" | "data";
  field?: string;
  includeTrigger?: boolean;
  clearOnTrigger?: boolean;
}

interface MutableState<TBreadcrumb> {
  key: string;
  buffer: TBreadcrumb[];
  lastSeenMs: number;
}

function defaultKey(event: LogEvent): string {
  const contextKey = event.context?.sessionId ?? event.context?.userId;
  return event.trace?.traceId ?? (contextKey === undefined ? event.logger : String(contextKey));
}

function defaultBreadcrumb(event: LogEvent): Breadcrumb {
  return {
    time: event.time,
    levelName: event.levelName,
    logger: event.logger,
    message: event.message,
    type: event.type,
    tags: event.tags,
    source: event.source,
  };
}

function normalizeCount(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function normalizeBucketCount(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 1024;
  return Math.max(1, Math.floor(value));
}

function snapshot<TBreadcrumb>(state: MutableState<TBreadcrumb>): BreadcrumbBufferState {
  return {
    key: state.key,
    buffered: state.buffer.length,
    lastSeenMs: state.lastSeenMs,
  };
}

function prune<TBreadcrumb>(
  states: Map<string, MutableState<TBreadcrumb>>,
  maxBuckets: number,
): void {
  while (states.size > maxBuckets) {
    let oldest: MutableState<TBreadcrumb> | undefined;
    for (const state of states.values()) {
      if (!oldest || state.lastSeenMs < oldest.lastSeenMs) oldest = state;
    }
    if (!oldest) return;
    states.delete(oldest.key);
  }
}

function attachBreadcrumbs<TBreadcrumb>(
  event: LogEvent,
  target: "context" | "data",
  field: string,
  breadcrumbs: readonly TBreadcrumb[],
): LogEvent {
  if (breadcrumbs.length === 0) return event;
  if (
    target === "data" &&
    event.data &&
    typeof event.data === "object" &&
    !Array.isArray(event.data)
  ) {
    return { ...event, data: { ...(event.data as Record<string, unknown>), [field]: breadcrumbs } };
  }
  if (target === "data") {
    return { ...event, data: { value: event.data, [field]: breadcrumbs } };
  }
  return { ...event, context: { ...event.context, [field]: breadcrumbs } };
}

export function breadcrumbBufferProcessor<TBreadcrumb = Breadcrumb>(
  options: BreadcrumbBufferOptions<TBreadcrumb> = {},
): BreadcrumbBufferProcessor {
  const triggerLevel = toLevelValue(options.triggerLevel ?? "error");
  const shouldAttach = options.shouldAttach ?? ((event: LogEvent) => event.level >= triggerLevel);
  const shouldBuffer = options.shouldBuffer ?? ((event: LogEvent) => event.level < triggerLevel);
  const bufferSize = normalizeCount(options.bufferSize, 50);
  const maxBuckets = normalizeBucketCount(options.maxBuckets);
  const keyFor = options.key ?? defaultKey;
  const map = options.map ?? (defaultBreadcrumb as (event: LogEvent) => TBreadcrumb);
  const target = options.target ?? "context";
  const field = options.field ?? "breadcrumbs";
  const includeTrigger = options.includeTrigger ?? false;
  const clearOnTrigger = options.clearOnTrigger ?? false;
  const states = new Map<string, MutableState<TBreadcrumb>>();

  const getState = (key: string, now: number): MutableState<TBreadcrumb> => {
    let state = states.get(key);
    if (!state) {
      state = { key, buffer: [], lastSeenMs: now };
      states.set(key, state);
      prune(states, maxBuckets);
    }
    state.lastSeenMs = now;
    return state;
  };

  const processor = ((event: LogEvent) => {
    const state = getState(keyFor(event), event.time);

    if (shouldAttach(event)) {
      const breadcrumbs = includeTrigger ? [...state.buffer, map(event)] : [...state.buffer];
      const next = attachBreadcrumbs(event, target, field, breadcrumbs);
      if (clearOnTrigger) state.buffer.splice(0, state.buffer.length);
      return next;
    }

    if (bufferSize > 0 && shouldBuffer(event)) {
      state.buffer.push(map(event));
      if (state.buffer.length > bufferSize) {
        state.buffer.splice(0, state.buffer.length - bufferSize);
      }
    }

    return event;
  }) as unknown as BreadcrumbBufferProcessor;

  processor.states = () => [...states.values()].map(snapshot);
  processor.reset = (key?: string) => {
    if (key) states.delete(key);
    else states.clear();
  };

  return processor;
}
