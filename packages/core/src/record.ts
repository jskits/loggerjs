import { toLevelName, type EnabledLogLevelName } from "./levels";
import type {
  BoundContext,
  EncodeContext,
  LoggerCategory,
  LogEvent,
  LogRecord,
  LogSource,
  SerializedError,
} from "./types";
import { normalizeError } from "./utils/error";

export interface CreateRecordOptions {
  time: number;
  level: number;
  category?: LoggerCategory;
  type?: string | null;
  tags?: LogEvent["tags"] | null;
  trace?: LogEvent["trace"] | null;
  msg?: string | null;
  lazy?: (() => string) | null;
  props?: Record<string, unknown> | null;
  err?: unknown;
  ctx?: BoundContext | null;
  source?: string;
  stack?: string | null;
  seq: number;
}

export interface RecordToEventOptions {
  id?: string | ((record: LogRecord, levelName: EnabledLogLevelName) => string);
  levelName?: EnabledLogLevelName;
  logger?: string;
  type?: string;
  tags?: LogEvent["tags"];
  data?: unknown;
  error?: SerializedError;
  trace?: LogEvent["trace"];
  source?: LogSource;
}

export type CodecInput = LogEvent | LogRecord | readonly (LogEvent | LogRecord)[];

const defaultCategory = Object.freeze(["app"]);

export function normalizeCategory(category: LoggerCategory | undefined): readonly string[] {
  if (category === undefined) return defaultCategory;
  if (typeof category === "string") return Object.freeze([category]);
  if (category.length === 0) return defaultCategory;
  return Object.freeze([...category]);
}

export function createBoundContext(
  bindings: Record<string, unknown> | null | undefined,
): BoundContext | null {
  if (!bindings || Object.keys(bindings).length === 0) return null;
  return Object.freeze({ ...bindings });
}

export function createEncodeContext(): EncodeContext {
  return {
    levelName: toLevelName,
    ctxCache: new WeakMap<object, unknown>(),
    schemaCache: new WeakMap<object, unknown>(),
  };
}

export function createRecord(options: CreateRecordOptions): LogRecord {
  return {
    time: options.time,
    level: options.level,
    category: normalizeCategory(options.category),
    type: options.type ?? null,
    // Shared by reference: logger-level tags are frozen, so middleware must
    // replace record.tags (like record.ctx) rather than mutate it in place.
    tags: options.tags ?? null,
    trace: options.trace ?? null,
    msg: options.msg ?? null,
    lazy: options.lazy ?? null,
    props: options.props ?? null,
    err: options.err ?? null,
    ctx: options.ctx ?? null,
    source: options.source ?? "app",
    stack: options.stack ?? null,
    seq: options.seq,
  };
}

export function cloneRecord(record: LogRecord, patch: Partial<LogRecord> = {}): LogRecord {
  return {
    time: patch.time ?? record.time,
    level: patch.level ?? record.level,
    category: patch.category ?? record.category,
    type: patch.type ?? record.type,
    tags: patch.tags ?? record.tags,
    trace: patch.trace ?? record.trace,
    msg: patch.msg ?? record.msg,
    lazy: patch.lazy ?? record.lazy,
    props: patch.props ?? record.props,
    err: patch.err ?? record.err,
    ctx: patch.ctx ?? record.ctx,
    source: patch.source ?? record.source,
    stack: patch.stack ?? record.stack,
    seq: patch.seq ?? record.seq,
  };
}

export function resolveMessage(record: LogRecord): string {
  if (record.msg !== null) return record.msg;
  if (!record.lazy) return "";

  try {
    record.msg = record.lazy();
  } catch (error) {
    record.msg = "[loggerjs message resolver failed]";
    if (record.err === null || record.err === undefined) record.err = error;
  } finally {
    record.lazy = null;
  }

  return record.msg;
}

// toString(36) on a millisecond timestamp costs hundreds of nanoseconds, and
// the timestamp only changes once per millisecond. Memoize the encoded
// segment so bursts of logs in the same millisecond pay it once.
let lastIdTime = -1;
let lastIdTimeSegment = "";

/**
 * Formats the default `time36-seq36-levelName` id shared by
 * {@link defaultRecordId} and the logger's default id factory.
 */
export function formatDefaultId(time: number, seq: number, levelName: string): string {
  if (time !== lastIdTime) {
    lastIdTime = time;
    lastIdTimeSegment = time.toString(36);
  }
  return `${lastIdTimeSegment}-${seq.toString(36)}-${levelName}`;
}

/**
 * Derives the id a record receives when it is projected to an event without a
 * configured id factory. Record-aware transports that encode records directly
 * never consult the logger's `idFactory`; they get this id instead. Codecs that
 * stamp ids onto raw records must use this function so both paths agree.
 */
export function defaultRecordId(record: LogRecord, levelName: EnabledLogLevelName): string {
  return formatDefaultId(record.time, record.seq, levelName);
}

function sourceForRecord(record: LogRecord): LogSource | undefined {
  if (record.source === "app") return undefined;
  return { integration: record.source };
}

function errorForRecord(record: LogRecord): SerializedError | undefined {
  if (record.err === null || record.err === undefined) return undefined;
  return normalizeError(record.err);
}

export function recordToEvent(record: LogRecord, options: RecordToEventOptions = {}): LogEvent {
  const levelName = options.levelName ?? toLevelName(record.level);
  const id =
    typeof options.id === "function"
      ? options.id(record, levelName)
      : (options.id ?? defaultRecordId(record, levelName));

  return {
    id,
    time: record.time,
    seq: record.seq,
    level: record.level,
    levelName,
    logger: options.logger ?? record.category.join("."),
    message: resolveMessage(record),
    type: options.type ?? record.type ?? undefined,
    tags: options.tags ?? record.tags ?? undefined,
    data: options.data ?? record.props ?? undefined,
    error: options.error ?? errorForRecord(record),
    context: record.ctx ?? undefined,
    trace: options.trace ?? record.trace ?? undefined,
    source: options.source ?? sourceForRecord(record),
  };
}

function propsFromEventData(data: unknown): Record<string, unknown> | null {
  if (data === undefined) return null;
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return { value: data };
}

function categoryFromEventLogger(logger: string): LoggerCategory | undefined {
  const category = logger.split(".").filter(Boolean);
  return category.length > 0 ? category : undefined;
}

/**
 * Conversion is lossy: a `runtime` source collapses into the record's string
 * source (and projects back as `integration`), and scalar `data` values are
 * wrapped as `{ value }` because record props must be an object. An event
 * without a source maps to the "app" source so a round trip through
 * {@link recordToEvent} leaves the source undefined again.
 */
export function eventToRecord(event: LogEvent): LogRecord {
  return createRecord({
    time: event.time,
    level: event.level,
    category: categoryFromEventLogger(event.logger),
    type: event.type ?? null,
    tags: event.tags ?? null,
    trace: event.trace ?? null,
    msg: event.message,
    props: propsFromEventData(event.data),
    err: event.error ?? null,
    ctx: createBoundContext(event.context),
    source: event.source?.integration ?? event.source?.runtime ?? "app",
    seq: event.seq,
  });
}

export function isLogRecord(value: unknown): value is LogRecord {
  return (
    value !== null &&
    typeof value === "object" &&
    "category" in value &&
    "type" in value &&
    "tags" in value &&
    "trace" in value &&
    "msg" in value &&
    "lazy" in value &&
    "seq" in value
  );
}

export function normalizeCodecInput(input: CodecInput): LogEvent | LogEvent[] {
  if (Array.isArray(input)) {
    const items = input as readonly (LogEvent | LogRecord)[];
    return items.map((item) => (isLogRecord(item) ? recordToEvent(item) : item));
  }
  if (isLogRecord(input)) return recordToEvent(input);
  return input as LogEvent;
}
