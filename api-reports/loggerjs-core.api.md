# API Report: @loggerjs/core

Generated from `packages/core/dist/**/*.d.ts`.
Update with `pnpm build && pnpm api:report` after intentional public API changes.

## codecs/json.d.ts

```ts
import type { Codec } from "../types.js";
import { type SafeStringifyOptions } from "../utils/safe-stringify.js";
export declare function jsonCodec(): Codec<string>;
export declare function safeJsonCodec(options?: SafeStringifyOptions): Codec<string>;
export declare function ndjsonCodec(options?: SafeStringifyOptions): Codec<string>;
```

## context.d.ts

```ts
import type { BoundContext } from "./types.js";
export type ContextProvider = () => Record<string, unknown> | undefined;
export interface ContextManager {
    get: () => BoundContext | undefined;
    with: <T>(context: Record<string, unknown>, fn: () => T) => T;
}
export declare function setContextProvider(nextProvider: ContextProvider | undefined): void;
export declare function setContextManager(nextManager: ContextManager): void;
export declare function resetContextManager(): void;
export declare function getContext(): BoundContext | undefined;
export declare function withContext<T>(context: Record<string, unknown>, fn: () => T): T;
```

## event-route.d.ts

```ts
import type { LogEvent } from "./types.js";
export declare const LOGGERJS_ROUTE: "__loggerjsRoute";
export interface LogEventRoute {
    transports?: readonly string[];
    excludeTransports?: readonly string[];
}
export type RoutableLogEvent = LogEvent & {
    [LOGGERJS_ROUTE]?: LogEventRoute;
};
export declare function getLogEventRoute(event: LogEvent): LogEventRoute | undefined;
export declare function withLogEventRoute(event: LogEvent, route: LogEventRoute): LogEvent;
```

## events.d.ts

```ts
import type { EventDefinition } from "./types.js";
export declare function defineEvent<TPayload extends Record<string, unknown>>(definition: EventDefinition<TPayload>): EventDefinition<TPayload>;
```

## index.d.ts

```ts
export * from "./levels.js";
export * from "./types.js";
export * from "./record.js";
export * from "./context.js";
export * from "./events.js";
export * from "./event-route.js";
export * from "./logger.js";
export * from "./registry.js";
export * from "./meta.js";
export * from "./middleware.js";
export * from "./integration-api.js";
export * from "./utils/error.js";
export * from "./utils/safe-stringify.js";
export * from "./codecs/json.js";
export * from "./transports/console.js";
export * from "./transports/memory.js";
export * from "./transports/batch.js";
export * from "./transports/test.js";
```

## integration-api.d.ts

```ts
import type { CaptureInput, IntegrationSetupContext, LoggerCategory, LoggerLike, Teardown, UnpatchedRegistry } from "./types.js";
export interface CreateIntegrationSetupContextOptions {
    name: string;
    logger: LoggerLike;
    capture: (input: CaptureInput) => void;
    getLogger: (category: LoggerCategory) => LoggerLike;
}
export declare function getUnpatchedRegistry(): UnpatchedRegistry;
export declare function registerUnpatchedDefaults(registry?: UnpatchedRegistry): UnpatchedRegistry;
export declare function onceTeardown(teardown: Teardown): Teardown;
export declare function createIntegrationSetupContext(options: CreateIntegrationSetupContextOptions): IntegrationSetupContext;
```

## levels.d.ts

```ts
export declare const levelValues: {
    readonly trace: 10;
    readonly debug: 20;
    readonly info: 30;
    readonly warn: 40;
    readonly error: 50;
    readonly fatal: 60;
    readonly silent: number;
};
export type EnabledLogLevelName = "trace" | "debug" | "info" | "warn" | "error" | "fatal";
export type LoggerLevelName = EnabledLogLevelName | "silent";
export type LoggerLevel = LoggerLevelName | number;
export declare const enabledLevelNames: readonly EnabledLogLevelName[];
export declare function toLevelValue(level: LoggerLevel | undefined, fallback?: number): number;
export declare function toLevelName(value: number): EnabledLogLevelName;
export declare function isLevelEnabled(level: LoggerLevel, minimumLevel: LoggerLevel): boolean;
```

## logger.d.ts

```ts
import { levelValues, type LoggerLevel } from "./levels.js";
import type { ChildLoggerOptions, CaptureInput, EventDefinition, EventLogOptions, Integration, LogData, LoggerLike, LoggerOptions, Processor, Tags, Transport } from "./types.js";
export declare class Logger implements LoggerLike {
    readonly name: string;
    private readonly category;
    private minimumLevel;
    private minimumLevelValue;
    private type?;
    private tags?;
    private bindings?;
    private middleware;
    private processors;
    private transports;
    private integrations;
    private installedIntegrations;
    private disposers;
    private contextProvider?;
    private clock;
    private idFactory;
    private onInternalError?;
    private closed;
    constructor(options?: LoggerOptions);
    setLevel(level: LoggerLevel): void;
    getLevel(): LoggerLevel;
    isEnabled(level: LoggerLevel): boolean;
    isLevelEnabled(level: LoggerLevel): boolean;
    child(options?: ChildLoggerOptions): Logger;
    withTags(tags: Tags): Logger;
    withType(type: string): Logger;
    addProcessor(processor: Processor): void;
    addTransport(transport: Transport): void;
    addIntegration(integration: Integration): void;
    log(level: LoggerLevel, message: unknown, data?: LogData | string, props?: LogData): void;
    capture(input: CaptureInput): void;
    event<TPayload extends Record<string, unknown>>(definition: EventDefinition<TPayload>, payload: TPayload, options?: EventLogOptions<TPayload>): void;
    private emitRecord;
    trace(message: unknown, data?: LogData | string, props?: LogData): void;
    debug(message: unknown, data?: LogData | string, props?: LogData): void;
    info(message: unknown, data?: LogData | string, props?: LogData): void;
    warn(message: unknown, data?: LogData | string, props?: LogData): void;
    error(message: unknown, data?: LogData | string, props?: LogData): void;
    fatal(message: unknown, data?: LogData | string, props?: LogData): void;
    captureException(error: unknown, data?: LogData): void;
    flush(): Promise<void>;
    flushSync(): void;
    close(): Promise<void>;
    private installIntegrations;
    private setupIntegration;
    private applyProcessors;
    private createEvent;
    private createRecordTransportContext;
    private createEventTransportContext;
    private dispatchRecord;
    private dispatchEvent;
    private reportInternalError;
}
export declare function createLogger(options?: LoggerOptions): Logger;
export { levelValues };
```

## meta.d.ts

```ts
export type LoggerMetaStats = Record<string, number>;
export declare function incrementLoggerMetaCounter(name: string, amount?: number): void;
export declare function getLoggerMetaStats(): LoggerMetaStats;
export declare function resetLoggerMetaStats(): void;
export declare function reportLoggerMetaError(error: unknown, detail: Record<string, unknown> | undefined, handler: ((error: unknown, detail?: Record<string, unknown>) => void) | undefined): void;
```

## middleware.d.ts

```ts
import type { LogRecord, Middleware, MiddlewareContext } from "./types.js";
export type MiddlewareProcess = Middleware["process"];
export declare function createMiddleware(name: string, process: MiddlewareProcess): Middleware;
export declare function runMiddleware(record: LogRecord, middleware: readonly Middleware[], context: MiddlewareContext): LogRecord | null;
```

## record.d.ts

```ts
import { type EnabledLogLevelName } from "./levels.js";
import type { BoundContext, EncodeContext, LoggerCategory, LogEvent, LogRecord, LogSource, SerializedError } from "./types.js";
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
export declare function normalizeCategory(category: LoggerCategory | undefined): readonly string[];
export declare function createBoundContext(bindings: Record<string, unknown> | null | undefined): BoundContext | null;
export declare function createEncodeContext(): EncodeContext;
export declare function createRecord(options: CreateRecordOptions): LogRecord;
export declare function cloneRecord(record: LogRecord, patch?: Partial<LogRecord>): LogRecord;
export declare function resolveMessage(record: LogRecord): string;
/**
 * Derives the id a record receives when it is projected to an event without a
 * configured id factory. Record-aware transports that encode records directly
 * never consult the logger's `idFactory`; they get this id instead. Codecs that
 * stamp ids onto raw records must use this function so both paths agree.
 */
export declare function defaultRecordId(record: LogRecord, levelName: EnabledLogLevelName): string;
export declare function recordToEvent(record: LogRecord, options?: RecordToEventOptions): LogEvent;
/**
 * Conversion is lossy: a `runtime` source collapses into the record's string
 * source (and projects back as `integration`), and scalar `data` values are
 * wrapped as `{ value }` because record props must be an object. An event
 * without a source maps to the "app" source so a round trip through
 * {@link recordToEvent} leaves the source undefined again.
 */
export declare function eventToRecord(event: LogEvent): LogRecord;
export declare function isLogRecord(value: unknown): value is LogRecord;
export declare function normalizeCodecInput(input: CodecInput): LogEvent | LogEvent[];
```

## registry.d.ts

```ts
import type { LoggerLevel } from "./levels.js";
import type { ChildLoggerOptions, EventDefinition, EventLogOptions, Integration, LogData, LoggerCategory, LoggerLike, Processor, Transport } from "./types.js";
export interface LoggerRoute {
    category: LoggerCategory;
    level?: LoggerLevel;
    transports?: string[];
    processors?: Processor[];
}
export interface ConfigureOptions {
    reset?: boolean;
    level?: LoggerLevel;
    processors?: Processor[];
    transports?: Record<string, Transport> | readonly Transport[];
    loggers?: LoggerRoute[];
    integrations?: Integration[];
}
export declare function resetLoggerRegistry(): Promise<void>;
export declare function configure(options?: ConfigureOptions): Promise<void>;
export declare class RegistryLogger implements LoggerLike {
    readonly category: readonly string[];
    constructor(category: LoggerCategory);
    child(options?: ChildLoggerOptions): RegistryLogger;
    log(level: LoggerLevel, message: unknown, data?: LogData | string, props?: LogData): void;
    trace(message: unknown, data?: LogData | string, props?: LogData): void;
    debug(message: unknown, data?: LogData | string, props?: LogData): void;
    info(message: unknown, data?: LogData | string, props?: LogData): void;
    warn(message: unknown, data?: LogData | string, props?: LogData): void;
    error(message: unknown, data?: LogData | string, props?: LogData): void;
    fatal(message: unknown, data?: LogData | string, props?: LogData): void;
    captureException(error: unknown, data?: LogData): void;
    event<TPayload extends Record<string, unknown>>(definition: EventDefinition<TPayload>, payload: TPayload, options?: EventLogOptions<TPayload>): void;
    flush(): Promise<void>;
    flushSync(): void;
    close(): Promise<void>;
}
export declare function getLogger(category: LoggerCategory): RegistryLogger;
```

## transports/batch.d.ts

```ts
import type { LogEvent, LogRecord, Transport } from "../types.js";
export type DropPolicy = "drop-oldest" | "drop-newest" | "throw";
export interface BatchTransportOptions {
    name?: string;
    maxRecords?: number;
    maxBatchSize?: number;
    maxBytes?: number;
    maxWaitMs?: number;
    flushIntervalMs?: number;
    concurrency?: number;
    maxQueueSize?: number;
    dropPolicy?: DropPolicy;
    estimateEventBytes?: (event: LogEvent) => number;
    estimateRecordBytes?: (record: LogRecord) => number;
    maxRetries?: number;
    retryBaseDelayMs?: number;
    retryMaxDelayMs?: number;
    random?: () => number;
    circuitBreakerFailureThreshold?: number;
    circuitBreakerResetMs?: number;
    onDrop?: (event: LogEvent, reason: string) => void;
}
export declare function estimateLogEventBytes(event: LogEvent): number;
export declare function estimateLogRecordBytes(record: LogRecord): number;
export declare function batchTransport(inner: Transport, options?: BatchTransportOptions): Transport;
```

## transports/console.d.ts

```ts
import type { Codec, LogEvent, Transport } from "../types.js";
export interface ConsoleTransportOptions {
    name?: string;
    pretty?: boolean;
    includeEvent?: boolean;
    codec?: Codec<string | Uint8Array>;
    filter?: (event: LogEvent) => boolean;
}
export declare function consoleTransport(options?: ConsoleTransportOptions): Transport;
```

## transports/memory.d.ts

```ts
import type { LogEvent, Transport } from "../types.js";
export interface MemoryTransport extends Transport {
    events: LogEvent[];
    clear: () => void;
}
export declare function memoryTransport(options?: {
    maxEvents?: number;
    name?: string;
}): MemoryTransport;
```

## transports/test.d.ts

```ts
import type { LogEvent, Transport } from "../types.js";
export type TestTransportMatcher = (event: LogEvent) => boolean;
export interface TestTransportWaitOptions {
    timeoutMs?: number;
    signal?: AbortSignal;
}
export interface TestTransportWaitForCountOptions extends TestTransportWaitOptions {
    matcher?: TestTransportMatcher;
}
export interface TestTransportStats {
    writeCalls: number;
    writeBatchCalls: number;
    logCalls: number;
    logBatchCalls: number;
    flushCalls: number;
    closeCalls: number;
    droppedEvents: number;
}
export interface TestTransportOptions {
    name?: string;
    maxEvents?: number;
    cloneEvent?: (event: LogEvent) => LogEvent;
}
export interface TestTransport extends Transport {
    events: LogEvent[];
    batches: LogEvent[][];
    stats: TestTransportStats;
    clear: () => void;
    reset: () => void;
    failNext: (error?: unknown) => void;
    waitFor: (matcher?: TestTransportMatcher, options?: TestTransportWaitOptions) => Promise<LogEvent>;
    waitForCount: (count: number, options?: TestTransportWaitForCountOptions) => Promise<LogEvent[]>;
}
export declare function testTransport(transportOptions?: TestTransportOptions): TestTransport;
```

## types.d.ts

```ts
import type { EnabledLogLevelName, LoggerLevel } from "./levels.js";
export type Primitive = string | number | boolean | null | undefined | bigint | symbol;
export type Jsonish = Primitive | Jsonish[] | {
    [key: string]: Jsonish;
};
export type Tags = Record<string, string | number | boolean | null | undefined>;
export type LoggerCategory = string | readonly string[];
export type BoundContext = Readonly<Record<string, unknown>>;
export type LogData = Record<string, unknown> | unknown[] | string | number | boolean | Error | null | undefined;
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
    type: string | null;
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
export interface EventDefinition<TPayload extends Record<string, unknown> = Record<string, unknown>> {
    readonly type: string;
    readonly level?: LoggerLevel;
    readonly message?: string | ((payload: TPayload) => string);
    readonly tags?: Tags | ((payload: TPayload) => Tags | undefined);
}
export interface EventLogOptions<TPayload extends Record<string, unknown> = Record<string, unknown>> {
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
    encode: (input: LogEvent | LogRecord | readonly (LogEvent | LogRecord)[], context?: EncodeContext) => TPayload;
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
    event: <TPayload extends Record<string, unknown>>(definition: EventDefinition<TPayload>, payload: TPayload, options?: EventLogOptions<TPayload>) => void;
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
```

## utils/error.d.ts

```ts
import type { SerializedError } from "../types.js";
export interface NormalizeErrorOptions {
    maxStackLines?: number;
    includeEnumerableProperties?: boolean;
}
export declare function normalizeError(error: unknown, options?: NormalizeErrorOptions): SerializedError;
export declare function valueToMessage(value: unknown): string;
```

## utils/safe-stringify.d.ts

```ts
export interface SafeStringifyOptions {
    maxDepth?: number;
    maxArrayLength?: number;
    maxObjectKeys?: number;
    includeStack?: boolean;
    stable?: boolean;
    space?: number;
}
export declare function normalizeValue(value: unknown, options?: SafeStringifyOptions): unknown;
export declare function safeJsonStringify(value: unknown, options?: SafeStringifyOptions): string;
```
