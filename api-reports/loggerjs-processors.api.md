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

## index.d.ts

```ts
export * from "./redact.js";
export * from "./sample.js";
export * from "./tags.js";
export * from "./dedupe.js";
export * from "./trace.js";
export * from "./rate-limit.js";
export { redactProcessor as redact } from "./redact.js";
export { sampleProcessor as sample } from "./sample.js";
export { tagsProcessor as tags, typeProcessor as logType, contextProcessor as context, } from "./tags.js";
export { dedupeProcessor as dedupe } from "./dedupe.js";
export { traceContextProcessor as traceContext } from "./trace.js";
export { rateLimitProcessor as rateLimit } from "./rate-limit.js";
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
