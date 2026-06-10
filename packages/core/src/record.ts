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

export type CodecInput = LogEvent | readonly LogEvent[] | readonly LogRecord[];

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

function defaultRecordId(record: LogRecord, levelName: EnabledLogLevelName): string {
  return `${record.time.toString(36)}-${record.seq.toString(36)}-${levelName}`;
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
    type: options.type,
    tags: options.tags,
    data: options.data ?? record.props ?? undefined,
    error: options.error ?? errorForRecord(record),
    context: record.ctx ?? undefined,
    trace: options.trace,
    source: options.source ?? sourceForRecord(record),
  };
}

export function isLogRecord(value: unknown): value is LogRecord {
  return (
    value !== null &&
    typeof value === "object" &&
    "category" in value &&
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
  return input as LogEvent;
}
