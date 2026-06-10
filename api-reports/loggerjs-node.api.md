# API Report: @loggerjs/node

Generated from `packages/node/dist/**/*.d.ts`.
Update with `pnpm build && pnpm api:report` after intentional public API changes.

## context.d.ts

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { type ContextManager } from "@loggerjs/core";
export declare function createAsyncLocalStorageContextManager(storage?: AsyncLocalStorage<Readonly<Record<string, unknown>>>): ContextManager & {
    disable: () => void;
};
export declare function installAsyncLocalStorageContext(manager?: ContextManager & {
    disable: () => void;
}): () => void;
```

## diagnostics-channel-integration.d.ts

```ts
import { type Integration } from "@loggerjs/core";
export interface DiagnosticsChannelModule {
    subscribe: (name: string, listener: (message: unknown, name: string) => void) => void;
    unsubscribe?: (name: string, listener: (message: unknown, name: string) => void) => void;
}
export interface DiagnosticsChannelIntegrationOptions {
    channels?: readonly string[];
    diagnosticsChannel?: DiagnosticsChannelModule | null;
    captureMessage?: boolean;
}
export declare function diagnosticsChannelIntegration(options?: DiagnosticsChannelIntegrationOptions): Integration;
```

## file-transport.d.ts

```ts
import { type WriteStream } from "fs";
import { type Codec, type LoggerLevel, type Transport } from "@loggerjs/core";
export interface FileTransportOptions {
    path: string;
    name?: string;
    codec?: Codec<string | Uint8Array>;
    minLevel?: LoggerLevel;
    flags?: string;
}
export interface FileTransport extends Transport {
    stream: WriteStream;
    flushSync: () => void;
}
export declare function fileTransport(options: FileTransportOptions): FileTransport;
```

## http-transport.d.ts

```ts
import { type BatchTransportOptions, type Codec, type LoggerLevel, type Transport } from "@loggerjs/core";
export interface NodeHttpTransportOptions extends BatchTransportOptions {
    url: string;
    name?: string;
    method?: "POST" | "PUT";
    headers?: Record<string, string>;
    codec?: Codec<string | Uint8Array>;
    minLevel?: LoggerLevel;
    fetchFn?: typeof fetch;
}
export declare function nodeHttpTransport(options: NodeHttpTransportOptions): Transport;
```

## index.d.ts

```ts
export * from "@loggerjs/core";
export * from "./stdout-transport.js";
export * from "./file-transport.js";
export * from "./rotating-file-transport.js";
export * from "./http-transport.js";
export * from "./worker-transport.js";
export * from "./context.js";
export * from "./process-integration.js";
export * from "./diagnostics-channel-integration.js";
```

## internal-types.d.ts

```ts
export interface WritableLike {
    write: (chunk: string | Uint8Array, callback?: (error?: Error | null) => void) => unknown;
    once?: (event: "drain", listener: () => void) => unknown;
    end?: (callback?: (error?: Error | null) => void) => unknown;
}
```

## process-integration.d.ts

```ts
import { type Integration } from "@loggerjs/core";
export interface CaptureProcessOptions {
    uncaughtException?: boolean;
    unhandledRejection?: boolean;
    warning?: boolean;
    beforeExitFlush?: boolean;
    exitFlush?: boolean;
    exitOnUncaught?: boolean;
    flushTimeoutMs?: number;
    exitFn?: (code: number) => void;
}
export declare function captureProcessIntegration(options?: CaptureProcessOptions): Integration;
```

## rotating-file-transport.d.ts

```ts
import { type Codec, type LoggerLevel, type Transport } from "@loggerjs/core";
export interface RotatingFileTransportOptions {
    path: string;
    name?: string;
    codec?: Codec<string | Uint8Array>;
    minLevel?: LoggerLevel;
    flags?: string;
    maxBytes?: number;
    maxFiles?: number;
    archivePath?: (path: string, index: number) => string;
}
export interface RotatingFileTransport extends Transport {
    rotate: () => void;
    flushSync: () => void;
    currentBytes: () => number;
}
export declare function rotatingFileTransport(options: RotatingFileTransportOptions): RotatingFileTransport;
```

## stdout-transport.d.ts

```ts
import { type Codec, type LoggerLevel, type Transport } from "@loggerjs/core";
import type { WritableLike } from "./internal-types.js";
export interface StdoutTransportOptions {
    name?: string;
    stream?: WritableLike;
    codec?: Codec<string | Uint8Array>;
    minLevel?: LoggerLevel;
}
export declare function stdoutTransport(options?: StdoutTransportOptions): Transport;
export declare function stderrTransport(options?: Omit<StdoutTransportOptions, "stream">): Transport;
```

## worker-transport.d.ts

```ts
import { type Codec, type LoggerLevel, type Transport } from "@loggerjs/core";
export interface WorkerLike {
    postMessage: (value: unknown, transferList?: ArrayBuffer[]) => void;
    terminate?: () => void | number | Promise<number>;
    on?: (event: "error" | "exit", listener: (...args: unknown[]) => void) => unknown;
    off?: (event: "error" | "exit", listener: (...args: unknown[]) => void) => unknown;
}
export interface WorkerTransportMessage {
    type: "loggerjs:batch";
    codec: string;
    contentType: string;
    count: number;
    payload: Uint8Array;
}
export interface WorkerTransportOptions {
    name?: string;
    worker?: WorkerLike;
    workerFactory?: () => WorkerLike;
    workerScript?: string | URL;
    workerOptions?: object;
    fallback?: Transport;
    codec?: Codec<string | Uint8Array>;
    minLevel?: LoggerLevel;
    transferBuffers?: boolean;
}
export declare function workerTransport(options?: WorkerTransportOptions): Transport;
```
