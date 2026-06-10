# API Report: @loggerjs/browser

Generated from `packages/browser/dist/**/*.d.ts`.
Update with `pnpm build && pnpm api:report` after intentional public API changes.

## broadcast-channel-transport.d.ts

```ts
import { type LogEvent, type LoggerLevel, type Transport } from "@loggerjs/core";
export interface BrowserBroadcastChannelLike {
    postMessage: (message: unknown) => void;
    close?: () => void;
}
export type BrowserBroadcastChannelFactory = (channelName: string) => BrowserBroadcastChannelLike;
export interface BrowserBroadcastChannelEventMessage {
    type: "loggerjs.event";
    source: string;
    event: LogEvent;
}
export interface BrowserBroadcastChannelBatchMessage {
    type: "loggerjs.batch";
    source: string;
    events: readonly LogEvent[];
}
export type BrowserBroadcastChannelMessage = BrowserBroadcastChannelEventMessage | BrowserBroadcastChannelBatchMessage;
export interface BrowserBroadcastChannelMapContext {
    channelName: string;
    source: string;
}
export interface BrowserBroadcastChannelErrorDetail {
    operation: "create-channel" | "post-message" | "close-channel" | "on-error";
    droppedEvents: number;
}
export interface BrowserBroadcastChannelTransportOptions {
    channelName: string;
    name?: string;
    source?: string;
    minLevel?: LoggerLevel;
    channelFactory?: BrowserBroadcastChannelFactory;
    closeChannelOnClose?: boolean;
    mapEvent?: (event: LogEvent, context: BrowserBroadcastChannelMapContext) => unknown;
    mapBatch?: (events: readonly LogEvent[], context: BrowserBroadcastChannelMapContext) => unknown;
    onError?: (error: unknown, detail: BrowserBroadcastChannelErrorDetail) => void;
}
export declare function browserBroadcastChannelTransport(options: BrowserBroadcastChannelTransportOptions): Transport;
```

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
export * from "./broadcast-channel-transport.js";
export * from "./http-transport.js";
export * from "./service-worker-transport.js";
export * from "./websocket-transport.js";
export * from "./indexeddb-offline-queue.js";
export * from "./console-integration.js";
export * from "./error-integration.js";
export * from "./fetch-integration.js";
export * from "./xhr-integration.js";
export * from "./reporting-integration.js";
export * from "./web-vitals-integration.js";
export * from "./performance-integration.js";
export * from "./page-lifecycle.js";
```

## indexeddb-offline-queue.d.ts

```ts
import type { BrowserHttpDropPolicy, BrowserHttpOfflineEntry, BrowserHttpOfflineQueue } from "./http-transport.js";
export interface IndexedDbBrowserHttpOfflineQueueOptions {
    dbName?: string;
    storeName?: string;
    maxEntries?: number;
    dropPolicy?: BrowserHttpDropPolicy;
    indexedDB?: IDBFactory;
    onDrop?: (entry: BrowserHttpOfflineEntry, reason: string) => void;
}
export interface IndexedDbBrowserHttpOfflineQueue extends BrowserHttpOfflineQueue {
    size: () => Promise<number>;
    clear: () => Promise<void>;
    close: () => void;
}
export declare function indexedDbBrowserHttpOfflineQueue(options?: IndexedDbBrowserHttpOfflineQueueOptions): IndexedDbBrowserHttpOfflineQueue;
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

## performance-integration.d.ts

```ts
import type { Integration, LoggerLevel } from "@loggerjs/core";
export type BrowserPerformanceEntryType = "element" | "event" | "longtask" | "mark" | "measure" | "navigation" | "paint" | "resource" | string;
export interface BrowserPerformanceEntryPayload {
    name: string;
    entryType: string;
    startTime: number;
    duration: number;
    initiatorType?: string;
    nextHopProtocol?: string;
    renderBlockingStatus?: string;
    responseStatus?: number;
    transferSize?: number;
    encodedBodySize?: number;
    decodedBodySize?: number;
    workerStart?: number;
    redirectStart?: number;
    redirectEnd?: number;
    fetchStart?: number;
    domainLookupStart?: number;
    domainLookupEnd?: number;
    connectStart?: number;
    connectEnd?: number;
    requestStart?: number;
    responseStart?: number;
    responseEnd?: number;
    detail?: unknown;
}
export interface CapturePerformanceOptions {
    entryTypes?: readonly BrowserPerformanceEntryType[];
    level?: LoggerLevel | ((entry: BrowserPerformanceEntryPayload) => LoggerLevel);
    buffered?: boolean;
    emitExisting?: boolean;
    maxEntries?: number;
    minDurationMs?: number | Partial<Record<string, number>>;
    sampleRate?: number;
    random?: () => number;
    captureDetail?: boolean;
    sanitizeName?: (name: string, entryType: string) => string;
    ignore?: (entry: BrowserPerformanceEntryPayload) => boolean;
    PerformanceObserver?: typeof PerformanceObserver;
    performance?: Pick<Performance, "getEntriesByType">;
}
export declare function normalizeBrowserPerformanceEntry(entry: PerformanceEntry, options?: Pick<CapturePerformanceOptions, "captureDetail" | "sanitizeName">): BrowserPerformanceEntryPayload;
export declare function capturePerformanceIntegration(options?: CapturePerformanceOptions): Integration;
```

## reporting-integration.d.ts

```ts
import { type Integration, type LoggerLevel } from "@loggerjs/core";
export interface BrowserReportLike {
    type?: string;
    url?: string;
    body?: unknown;
    toJSON?: () => unknown;
}
export interface BrowserReportingObserverLike {
    observe: () => void;
    disconnect: () => void;
    takeRecords?: () => BrowserReportLike[];
}
export interface BrowserReportingObserverConstructor {
    new (callback: (reports: BrowserReportLike[], observer: BrowserReportingObserverLike) => void, options?: {
        buffered?: boolean;
        types?: readonly string[];
    }): BrowserReportingObserverLike;
}
export interface BrowserReportPayload {
    type: string;
    url?: string;
    body?: unknown;
}
export interface BrowserCspViolationPayload {
    type: "securitypolicyviolation";
    blockedURI?: string;
    documentURI?: string;
    effectiveDirective?: string;
    violatedDirective?: string;
    disposition?: string;
    sourceFile?: string;
    lineNumber?: number;
    columnNumber?: number;
    statusCode?: number;
    sample?: string;
}
export interface CaptureReportingOptions {
    captureSecurityPolicyViolation?: boolean;
    captureReportingObserver?: boolean;
    reportTypes?: readonly string[];
    level?: LoggerLevel | ((report: BrowserReportPayload | BrowserCspViolationPayload) => LoggerLevel);
    buffered?: boolean;
    sanitizeUrl?: (url: string) => string;
    ReportingObserver?: BrowserReportingObserverConstructor;
    addEventListener?: typeof globalThis.addEventListener;
    removeEventListener?: typeof globalThis.removeEventListener;
}
export declare function captureReportingIntegration(options?: CaptureReportingOptions): Integration;
```

## service-worker-transport.d.ts

```ts
import { type LogEvent, type LoggerLevel, type Transport } from "@loggerjs/core";
export type BrowserServiceWorkerDropPolicy = "drop-oldest" | "drop-newest";
export type BrowserServiceWorkerTarget = "controller" | "ready";
export interface BrowserServiceWorkerLike {
    postMessage: (message: unknown, transfer?: Transferable[] | StructuredSerializeOptions) => void;
}
export interface BrowserServiceWorkerRegistrationLike {
    active?: BrowserServiceWorkerLike | null;
    waiting?: BrowserServiceWorkerLike | null;
    installing?: BrowserServiceWorkerLike | null;
}
export interface BrowserServiceWorkerContainerLike {
    controller?: BrowserServiceWorkerLike | null;
    ready?: Promise<BrowserServiceWorkerRegistrationLike>;
}
export interface BrowserServiceWorkerEventMessage {
    type: "loggerjs.event";
    source: string;
    event: LogEvent;
}
export interface BrowserServiceWorkerBatchMessage {
    type: "loggerjs.batch";
    source: string;
    events: readonly LogEvent[];
}
export type BrowserServiceWorkerMessage = BrowserServiceWorkerEventMessage | BrowserServiceWorkerBatchMessage;
export interface BrowserServiceWorkerMapContext {
    source: string;
    target: BrowserServiceWorkerTarget;
}
export interface BrowserServiceWorkerTransportOptions {
    name?: string;
    minLevel?: LoggerLevel;
    source?: string;
    target?: BrowserServiceWorkerTarget;
    serviceWorker?: BrowserServiceWorkerContainerLike;
    maxQueueSize?: number;
    dropPolicy?: BrowserServiceWorkerDropPolicy;
    transfer?: (message: unknown) => Transferable[] | StructuredSerializeOptions | undefined;
    mapEvent?: (event: LogEvent, context: BrowserServiceWorkerMapContext) => unknown;
    mapBatch?: (events: readonly LogEvent[], context: BrowserServiceWorkerMapContext) => unknown;
    onDrop?: (event: LogEvent, reason: string) => void;
    onError?: (error: unknown, detail: {
        operation: string;
        droppedEvents: number;
    }) => void;
}
export declare function browserServiceWorkerTransport(options?: BrowserServiceWorkerTransportOptions): Transport & {
    queueSize: () => number;
};
```

## web-vitals-integration.d.ts

```ts
import type { Integration, LoggerLevel } from "@loggerjs/core";
export type WebVitalName = "CLS" | "FCP" | "INP" | "LCP" | "TTFB";
export type WebVitalRating = "good" | "needs-improvement" | "poor";
export interface WebVitalMetric {
    name: WebVitalName;
    value: number;
    delta: number;
    rating: WebVitalRating;
    id: string;
    final: boolean;
}
export interface CaptureWebVitalsOptions {
    metrics?: readonly WebVitalName[];
    level?: LoggerLevel;
    reportAllChanges?: boolean;
    flushOnHidden?: boolean;
    PerformanceObserver?: typeof PerformanceObserver;
    performance?: Pick<Performance, "getEntriesByName" | "getEntriesByType">;
    addEventListener?: typeof globalThis.addEventListener;
    removeEventListener?: typeof globalThis.removeEventListener;
}
export declare function captureWebVitalsIntegration(options?: CaptureWebVitalsOptions): Integration;
```

## websocket-transport.d.ts

```ts
import { type Codec, type LogEvent, type LoggerLevel, type Transport } from "@loggerjs/core";
export type BrowserWebSocketDropPolicy = "drop-oldest" | "drop-newest";
export type BrowserWebSocketPayload = string | Uint8Array;
export type BrowserWebSocketEventType = "close" | "error" | "open";
type BrowserWebSocketSendPayload = Parameters<WebSocket["send"]>[0];
export interface BrowserWebSocketLike {
    readonly readyState: number;
    send: (data: BrowserWebSocketSendPayload) => void;
    close: (code?: number, reason?: string) => void;
    addEventListener: (type: BrowserWebSocketEventType, listener: (event: Event) => void) => void;
    removeEventListener: (type: BrowserWebSocketEventType, listener: (event: Event) => void) => void;
}
export type BrowserWebSocketFactory = (url: string, protocols?: string | string[]) => BrowserWebSocketLike;
export interface BrowserWebSocketErrorDetail {
    operation: "close-socket" | "create-socket" | "send" | "socket-error" | "on-error";
    droppedEvents: number;
}
export interface BrowserWebSocketTransportOptions {
    url: string;
    name?: string;
    protocols?: string | string[];
    minLevel?: LoggerLevel;
    codec?: Codec<BrowserWebSocketPayload>;
    maxQueueSize?: number;
    dropPolicy?: BrowserWebSocketDropPolicy;
    webSocketFactory?: BrowserWebSocketFactory;
    closeCode?: number;
    closeReason?: string;
    onDrop?: (event: LogEvent, reason: string) => void;
    onError?: (error: unknown, detail: BrowserWebSocketErrorDetail) => void;
}
export interface BrowserWebSocketTransport extends Transport {
    queueSize: () => number;
}
export declare function browserWebSocketTransport(options: BrowserWebSocketTransportOptions): BrowserWebSocketTransport;
export {};
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
