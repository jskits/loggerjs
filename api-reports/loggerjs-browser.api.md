# API Report: @loggerjs/browser

Generated from `packages/browser/dist/**/*.d.ts`.
Update with `pnpm build && pnpm api:report` after intentional public API changes.

## console-integration.d.ts

```ts
import { type Integration } from "@loggerjs/core";
type ConsoleLevel = "debug" | "info" | "log" | "trace" | "warn" | "error";
export interface CaptureConsoleOptions {
    levels?: ConsoleLevel[];
    preserveConsole?: boolean;
    captureArguments?: boolean;
    maxCapturesPerSecond?: number;
}
export declare function captureConsoleIntegration(options?: CaptureConsoleOptions): Integration;
export {};
```

## error-integration.d.ts

```ts
import { type Integration } from "@loggerjs/core";
export interface CaptureBrowserErrorsOptions {
    captureWindowError?: boolean;
    captureUnhandledRejection?: boolean;
    captureResourceErrors?: boolean;
    captureSecurityPolicyViolation?: boolean;
    scriptErrorDedupeWindowMs?: number;
}
export declare function captureBrowserErrorsIntegration(options?: CaptureBrowserErrorsOptions): Integration;
```

## fetch-integration.d.ts

```ts
import { type Integration } from "@loggerjs/core";
export interface CaptureFetchOptions {
    minStatus?: number;
    captureRequestHeaders?: readonly string[];
    captureResponseHeaders?: readonly string[];
    captureAll?: boolean;
    captureSuccessful?: boolean;
    sampleRate?: number;
    random?: () => number;
    sanitizeUrl?: (url: string) => string;
}
export declare function captureFetchIntegration(options?: CaptureFetchOptions): Integration;
```

## http-capture-utils.d.ts

```ts
export declare function nowMs(): number;
export declare function durationMs(started: number): number;
export declare function sanitizeHttpUrl(rawUrl: string, sanitizer?: (url: string) => string): string;
export declare function pickAllowedHeaders(headers: Headers | undefined, allowList: readonly string[] | undefined): Record<string, string> | undefined;
export declare function headersFromInit(headers: HeadersInit | undefined): Headers | undefined;
export declare function shouldSample(sampleRate: number, random: () => number): boolean;
```

## http-transport.d.ts

```ts
import { type Codec, type LogEvent, type LoggerLevel, type Transport } from "@loggerjs/core";
export type BrowserHttpDropPolicy = "drop-oldest" | "drop-newest";
export interface BrowserHttpOfflineEntry {
    id: string;
    url: string;
    method: "POST" | "PUT";
    headers: Record<string, string>;
    body: string | Uint8Array;
    credentials?: RequestCredentials;
    keepalive: boolean;
    createdAt: number;
}
export interface BrowserHttpOfflineQueue {
    enqueue: (entry: BrowserHttpOfflineEntry) => void | Promise<void>;
    replay: (send: (entry: BrowserHttpOfflineEntry) => Promise<void>) => void | Promise<void>;
}
export interface MemoryBrowserHttpOfflineQueueOptions {
    maxEntries?: number;
    dropPolicy?: BrowserHttpDropPolicy;
    onDrop?: (entry: BrowserHttpOfflineEntry, reason: string) => void;
}
export interface BrowserHttpTransportOptions {
    url: string;
    name?: string;
    method?: "POST" | "PUT";
    headers?: Record<string, string>;
    credentials?: RequestCredentials;
    keepalive?: boolean;
    codec?: Codec<string | Uint8Array>;
    minLevel?: LoggerLevel;
    maxBatchSize?: number;
    flushIntervalMs?: number;
    maxQueueSize?: number;
    dropPolicy?: BrowserHttpDropPolicy;
    useBeaconOnPageHide?: boolean;
    beaconMaxBytes?: number;
    offlineQueue?: BrowserHttpOfflineQueue;
    offlineReplayMaxRetries?: number;
    offlineReplayBaseDelayMs?: number;
    offlineReplayMaxDelayMs?: number;
    random?: () => number;
    fetchFn?: typeof fetch;
    onDrop?: (event: LogEvent, reason: string) => void;
}
export declare function memoryBrowserHttpOfflineQueue(options?: MemoryBrowserHttpOfflineQueueOptions): BrowserHttpOfflineQueue & {
    size: () => number;
};
export declare function browserHttpTransport(options: BrowserHttpTransportOptions): Transport;
```

## index.d.ts

```ts
export * from "@loggerjs/core";
export * from "./http-transport.js";
export * from "./console-integration.js";
export * from "./error-integration.js";
export * from "./fetch-integration.js";
export * from "./xhr-integration.js";
export * from "./page-lifecycle.js";
```

## page-lifecycle.d.ts

```ts
import type { Integration } from "@loggerjs/core";
export interface PageLifecycleOptions {
    flushOnPageHide?: boolean;
    flushOnHidden?: boolean;
    coalesceMs?: number;
}
export declare function pageLifecycleIntegration(options?: PageLifecycleOptions): Integration;
```

## xhr-integration.d.ts

```ts
import type { Integration } from "@loggerjs/core";
export interface CaptureXHROptions {
    minStatus?: number;
    captureAll?: boolean;
    captureSuccessful?: boolean;
    sampleRate?: number;
    random?: () => number;
    sanitizeUrl?: (url: string) => string;
}
export declare function captureXHRIntegration(options?: CaptureXHROptions): Integration;
```
