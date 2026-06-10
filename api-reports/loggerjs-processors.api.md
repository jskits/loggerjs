# API Report: @loggerjs/processors

Generated from `packages/processors/dist/**/*.d.ts`.
Update with `pnpm build && pnpm api:report` after intentional public API changes.

## dedupe.d.ts

```ts
import type { LogEvent, Processor } from "@loggerjs/core";
export interface DedupeOptions {
    windowMs?: number;
    maxEntries?: number;
    key?: (event: LogEvent) => string;
}
export declare function dedupeProcessor(options?: DedupeOptions): Processor;
```

## enrich.d.ts

```ts
import type { LogEvent, Processor, ProcessorContext, Tags, TraceContext } from "@loggerjs/core";
export interface EnrichPatch {
    message?: string;
    type?: string;
    tags?: Tags;
    data?: unknown;
    context?: Record<string, unknown>;
    trace?: TraceContext;
    source?: LogEvent["source"];
}
export type EnrichInput = EnrichPatch | ((event: LogEvent, context: ProcessorContext) => EnrichPatch | false | void);
export declare function enrichProcessor(input: EnrichInput): Processor;
```

## filter-route.d.ts

```ts
import { type EnabledLogLevelName, type LogEvent, type LogEventRoute, type LoggerLevel, type Processor, type ProcessorContext, type Tags } from "@loggerjs/core";
export type EventStringMatcher = string | RegExp | ((value: string | undefined, event: LogEvent) => boolean);
export interface EventMatch {
    when?: (event: LogEvent, context: ProcessorContext) => boolean;
    logger?: EventStringMatcher | readonly EventStringMatcher[];
    type?: EventStringMatcher | readonly EventStringMatcher[];
    integration?: EventStringMatcher | readonly EventStringMatcher[];
    runtime?: EventStringMatcher | readonly EventStringMatcher[];
    levelName?: EnabledLogLevelName | readonly EnabledLogLevelName[];
    tags?: Tags;
    minLevel?: LoggerLevel;
    maxLevel?: LoggerLevel;
}
export type FilterAction = "keep" | "drop";
export type FilterPredicate = (event: LogEvent, context: ProcessorContext) => boolean;
export interface FilterRule extends EventMatch {
    action?: FilterAction;
    reason?: string;
}
export interface FilterOptions {
    rules: readonly FilterRule[];
    defaultAction?: FilterAction;
    onDrop?: (event: LogEvent, reason: string) => void;
}
export type FilterInput = FilterPredicate | readonly FilterRule[] | FilterOptions;
export interface RouteRule extends EventMatch, LogEventRoute {
}
export interface RouteOptions {
    rules: readonly RouteRule[];
    defaultRoute?: LogEventRoute;
}
export type RouteInput = LogEventRoute | readonly RouteRule[] | RouteOptions;
export declare function filterProcessor(input: FilterInput): Processor;
export declare function routeProcessor(input: RouteInput): Processor;
```

## fingerprint.d.ts

```ts
import type { LogEvent, Processor, ProcessorContext } from "@loggerjs/core";
export type FingerprintPart = "logger" | "level" | "type" | "message" | "error.name" | "error.message" | "source.integration" | "source.runtime" | "stack.top" | ((event: LogEvent, context: ProcessorContext) => unknown);
export interface FingerprintOptions {
    parts?: readonly FingerprintPart[];
    hash?: (input: string) => string;
    target?: "tags" | "context";
    key?: string;
    separator?: string;
    prefix?: string;
}
export declare function fingerprintProcessor(options?: FingerprintOptions): Processor;
```

## fingers-crossed.d.ts

```ts
import { type LogEvent, type LoggerLevel, type Processor, type ProcessorContext, type Transport } from "@loggerjs/core";
export type FingersCrossedDropReason = "buffer-full" | "bucket-pruned";
export type FingersCrossedFlush = (events: readonly LogEvent[], context: ProcessorContext) => void | Promise<void>;
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
export declare function fingersCrossedProcessor(options?: FingersCrossedOptions): FingersCrossedProcessor;
```

## index.d.ts

```ts
export * from "./redact.js";
export * from "./sample.js";
export * from "./tags.js";
export * from "./dedupe.js";
export * from "./trace.js";
export * from "./rate-limit.js";
export * from "./fingers-crossed.js";
export * from "./enrich.js";
export * from "./level-override.js";
export * from "./filter-route.js";
export * from "./fingerprint.js";
export { redactProcessor as redact } from "./redact.js";
export { sampleProcessor as sample } from "./sample.js";
export { tagsProcessor as tags, typeProcessor as logType, contextProcessor as context, } from "./tags.js";
export { dedupeProcessor as dedupe } from "./dedupe.js";
export { traceContextProcessor as traceContext } from "./trace.js";
export { rateLimitProcessor as rateLimit } from "./rate-limit.js";
export { fingersCrossedProcessor as fingersCrossed } from "./fingers-crossed.js";
export { enrichProcessor as enrich } from "./enrich.js";
export { levelOverrideProcessor as levelOverride } from "./level-override.js";
export { filterProcessor as filter, routeProcessor as route } from "./filter-route.js";
export { fingerprintProcessor as fingerprint } from "./fingerprint.js";
```

## level-override.d.ts

```ts
import { type LogEvent, type LoggerLevel, type Processor, type ProcessorContext, type Tags } from "@loggerjs/core";
export type LevelOverrideStringMatcher = string | RegExp | ((value: string | undefined, event: LogEvent) => boolean);
export type LevelOverrideValue = LoggerLevel | false | undefined | ((event: LogEvent, context: ProcessorContext) => LoggerLevel | false | void);
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
export type LevelOverrideInput = LevelOverrideValue | readonly LevelOverrideRule[] | LevelOverrideOptions;
export declare function levelOverrideProcessor(input: LevelOverrideInput): Processor;
```

## rate-limit.d.ts

```ts
import { type EnabledLogLevelName, type LogEvent, type Processor } from "@loggerjs/core";
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
export declare function rateLimitProcessor(options?: RateLimitOptions): RateLimitProcessor;
```

## redact.d.ts

```ts
import type { Processor } from "@loggerjs/core";
export type RedactMatcher = string | RegExp | ((key: string, path: string, value: unknown) => boolean);
export interface RedactOptions {
    keys?: RedactMatcher[];
    paths?: string[];
    replacement?: string;
    maxDepth?: number;
}
export declare function redactProcessor(options?: RedactOptions): Processor;
```

## sample.d.ts

```ts
import type { EnabledLogLevelName, Processor } from "@loggerjs/core";
export interface SampleOptions {
    defaultRate?: number;
    rates?: Partial<Record<EnabledLogLevelName, number>>;
    random?: () => number;
}
export declare function sampleProcessor(options?: SampleOptions): Processor;
```

## tags.d.ts

```ts
import type { Processor, Tags } from "@loggerjs/core";
export declare function tagsProcessor(tags: Tags): Processor;
export declare function typeProcessor(type: string): Processor;
export declare function contextProcessor(context: Record<string, unknown>): Processor;
```

## trace.d.ts

```ts
import type { Processor, TraceContext } from "@loggerjs/core";
export type TraceContextProvider = () => TraceContext | undefined;
export declare function traceContextProcessor(provider: TraceContextProvider): Processor;
```
