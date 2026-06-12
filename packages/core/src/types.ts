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
  baggage?: Record<string, string>;
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
  type: string | null;
  /**
   * May reference the logger's frozen tags object. Middleware must replace
   * this field (`record.tags = { ...record.tags, extra }`), never mutate the
   * object in place — the same contract as {@link LogRecord.ctx}.
   */
  tags: Tags | null;
  trace: TraceContext | null;
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

export interface EventDefinition<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly type: string;
  readonly level?: LoggerLevel;
  readonly message?: string | ((payload: TPayload) => string);
  readonly tags?: Tags | ((payload: TPayload) => Tags | undefined);
}

export interface EventLogOptions<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  level?: LoggerLevel;
  message?: string | ((payload: TPayload) => string);
  tags?: Tags;
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
  toEvent: (record: LogRecord) => LogEvent;
  reportInternalError: (error: unknown, detail?: Record<string, unknown>) => void;
}

export interface Transport {
  name?: string;
  minLevel?: LoggerLevel;
  write?: (record: LogRecord, context: TransportContext) => void | Promise<void>;
  writeBatch?: (records: LogRecord[], context: TransportContext) => void | Promise<void>;
  log?: (event: LogEvent, context: TransportContext) => void | Promise<void>;
  logBatch?: (events: LogEvent[], context: TransportContext) => void | Promise<void>;
  flush?: () => void | Promise<void>;
  flushSync?: () => void;
  close?: () => void | Promise<void>;
}

export interface Codec<TPayload = string | Uint8Array> {
  name: string;
  contentType: string;
  encode: (
    input: LogEvent | LogRecord | readonly (LogEvent | LogRecord)[],
    context?: EncodeContext,
  ) => TPayload;
  decode?: (payload: TPayload) => LogEvent | LogEvent[];
}

export type EncodedPayload = string | Uint8Array;

export interface PayloadTransformContext {
  contentType: string;
  headers?: Readonly<Record<string, string>>;
  transport?: string;
  events?: readonly LogEvent[];
}

export interface PayloadTransformOutput<TPayload extends EncodedPayload = EncodedPayload> {
  payload: TPayload;
  contentType?: string;
  headers?: Record<string, string>;
}

export type PayloadTransformResult<TPayload extends EncodedPayload = EncodedPayload> =
  | TPayload
  | PayloadTransformOutput<TPayload>;

export type PayloadTransform<
  TInput extends EncodedPayload = EncodedPayload,
  TOutput extends EncodedPayload = EncodedPayload,
> = (
  payload: TInput,
  context: PayloadTransformContext,
) =>
  | PayloadTransformResult<TOutput>
  | undefined
  | Promise<PayloadTransformResult<TOutput> | undefined>;

export interface LoggerLike {
  log: (level: LoggerLevel, message: unknown, data?: LogData | string, props?: LogData) => void;
  trace: (message: unknown, data?: LogData | string, props?: LogData) => void;
  debug: (message: unknown, data?: LogData | string, props?: LogData) => void;
  info: (message: unknown, data?: LogData | string, props?: LogData) => void;
  warn: (message: unknown, data?: LogData | string, props?: LogData) => void;
  error: (message: unknown, data?: LogData | string, props?: LogData) => void;
  fatal: (message: unknown, data?: LogData | string, props?: LogData) => void;
  captureException: (error: unknown, data?: LogData) => void;
  event: <TPayload extends Record<string, unknown>>(
    definition: EventDefinition<TPayload>,
    payload: TPayload,
    options?: EventLogOptions<TPayload>,
  ) => void;
  flush: () => Promise<void>;
  flushSync?: () => void;
  close: () => Promise<void>;
}

export type Teardown = () => void;

export type ConsoleMethod = "debug" | "error" | "info" | "log" | "trace" | "warn";
export type UnpatchedFunction = (...args: any[]) => unknown;

export interface UnpatchedRegistry {
  readonly console: Partial<Record<ConsoleMethod, (...args: unknown[]) => void>>;
  fetch?: UnpatchedFunction;
  XMLHttpRequest?: unknown;
  get: <T = unknown>(key: string) => T | undefined;
  set: <T = unknown>(key: string, value: T) => T;
}

export interface IntegrationAPI {
  capture: (input: CaptureInput) => void;
  getLogger: (category: LoggerCategory) => LoggerLike;
  readonly unpatched: UnpatchedRegistry;
  guard: <T extends (...args: never[]) => unknown>(fn: T) => T;
}

export type IntegrationSetupContext = LoggerLike & IntegrationAPI;

export interface Integration {
  name: string;
  setup: (api: IntegrationSetupContext) => void | Teardown;
}

export interface LoggerOptions {
  name?: string;
  category?: LoggerCategory;
  level?: LoggerLevel;
  type?: string;
  tags?: Tags;
  bindings?: Record<string, unknown>;
  middleware?: Middleware[];
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
  middleware?: Middleware[];
  processors?: Processor[];
  transports?: Transport[];
  integrations?: Integration[];
}
