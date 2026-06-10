import type { EnabledLogLevelName, LoggerLevel } from "./levels";

export type Primitive = string | number | boolean | null | undefined | bigint | symbol;
export type Jsonish = Primitive | Jsonish[] | { [key: string]: Jsonish };
export type Tags = Record<string, string | number | boolean | null | undefined>;
export type LoggerCategory = string | readonly string[];
export type BoundContext = Readonly<Record<string, unknown>>;
export type LogData =
  | Record<string, unknown>
  | unknown[]
  | string
  | number
  | boolean
  | Error
  | null
  | undefined;

export interface SerializedError {
  name?: string;
  message: string;
  stack?: string;
  cause?: unknown;
  code?: string | number;
  [key: string]: unknown;
}

export interface TraceContext {
  traceId?: string;
  spanId?: string;
  traceFlags?: string;
  sampled?: boolean;
  [key: string]: unknown;
}

export interface LogSource {
  runtime?: "browser" | "node" | "edge" | "unknown" | string;
  integration?: string;
  file?: string;
  line?: number;
  column?: number;
  [key: string]: unknown;
}

export interface LogRecord {
  time: number;
  level: number;
  category: readonly string[];
  msg: string | null;
  lazy: (() => string) | null;
  props: Record<string, unknown> | null;
  err: unknown;
  ctx: BoundContext | null;
  source: string;
  stack: string | null;
  seq: number;
}

export interface CaptureInput {
  level?: LoggerLevel;
  category?: LoggerCategory;
  message?: string | (() => string) | null;
  props?: Record<string, unknown> | null;
  error?: unknown;
  source?: string;
  stack?: string | null;
}

export interface MiddlewareContext {
  now: () => number;
  reportInternalError: (error: unknown, detail?: Record<string, unknown>) => void;
}

export type MiddlewareResult = LogRecord | null;

export interface Middleware {
  readonly name: string;
  process: (record: LogRecord, context: MiddlewareContext) => MiddlewareResult;
}

export interface EncodeContext {
  levelName: (level: number) => EnabledLogLevelName;
  ctxCache: WeakMap<object, unknown>;
  schemaCache: WeakMap<object, unknown>;
}

export interface LogEvent<TData = unknown> {
  id: string;
  time: number;
  seq: number;
  level: number;
  levelName: EnabledLogLevelName;
  logger: string;
  message: string;
  type?: string;
  tags?: Tags;
  data?: TData;
  error?: SerializedError;
  context?: Record<string, unknown>;
  trace?: TraceContext;
  source?: LogSource;
}

export interface ProcessorContext {
  loggerName: string;
  now: () => number;
  reportInternalError: (error: unknown, detail?: Record<string, unknown>) => void;
}

export type ProcessorResult = LogEvent | false | void;
export type Processor = (event: LogEvent, context: ProcessorContext) => ProcessorResult;

export interface TransportContext {
  loggerName: string;
  now: () => number;
  reportInternalError: (error: unknown, detail?: Record<string, unknown>) => void;
}

export interface Transport {
  name?: string;
  minLevel?: LoggerLevel;
  log?: (event: LogEvent, context: TransportContext) => void | Promise<void>;
  logBatch?: (events: LogEvent[], context: TransportContext) => void | Promise<void>;
  flush?: () => void | Promise<void>;
  close?: () => void | Promise<void>;
}

export interface Codec<TPayload = string | Uint8Array> {
  name: string;
  contentType: string;
  encode: (input: LogEvent | LogEvent[]) => TPayload;
  decode?: (payload: TPayload) => LogEvent | LogEvent[];
}

export interface LoggerLike {
  log: (level: LoggerLevel, message: unknown, data?: LogData | string, props?: LogData) => void;
  trace: (message: unknown, data?: LogData | string, props?: LogData) => void;
  debug: (message: unknown, data?: LogData | string, props?: LogData) => void;
  info: (message: unknown, data?: LogData | string, props?: LogData) => void;
  warn: (message: unknown, data?: LogData | string, props?: LogData) => void;
  error: (message: unknown, data?: LogData | string, props?: LogData) => void;
  fatal: (message: unknown, data?: LogData | string, props?: LogData) => void;
  captureException: (error: unknown, data?: LogData) => void;
  flush: () => Promise<void>;
  close: () => Promise<void>;
}

export interface Integration {
  name: string;
  setup: (logger: LoggerLike) => void | (() => void);
}

export interface LoggerOptions {
  name?: string;
  category?: LoggerCategory;
  level?: LoggerLevel;
  type?: string;
  tags?: Tags;
  bindings?: Record<string, unknown>;
  processors?: Processor[];
  transports?: Transport[];
  integrations?: Integration[];
  contextProvider?: () => Record<string, unknown> | undefined;
  clock?: () => number;
  idFactory?: (event: Pick<LogEvent, "time" | "seq" | "levelName" | "logger">) => string;
  onInternalError?: (error: unknown, detail?: Record<string, unknown>) => void;
}

export interface ChildLoggerOptions {
  name?: string;
  category?: LoggerCategory;
  level?: LoggerLevel;
  type?: string;
  tags?: Tags;
  bindings?: Record<string, unknown>;
  processors?: Processor[];
  transports?: Transport[];
  integrations?: Integration[];
}
