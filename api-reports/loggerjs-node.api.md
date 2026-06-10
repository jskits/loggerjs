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

## express-integration.d.ts

```ts
import { type LoggerLevel, type LoggerLike } from "@loggerjs/core";
export interface ExpressRequestLike {
    method?: string;
    originalUrl?: string;
    url?: string;
    path?: string;
    headers?: Record<string, string | string[] | undefined>;
    ip?: string;
    route?: {
        path?: string;
    };
    socket?: {
        remoteAddress?: string;
    };
    [key: string]: unknown;
}
export interface ExpressResponseLike {
    statusCode?: number;
    writableEnded?: boolean;
    headersSent?: boolean;
    getHeader?: (name: string) => number | string | string[] | undefined;
    once?: (event: "finish" | "close", listener: () => void) => unknown;
    on?: (event: "finish" | "close", listener: () => void) => unknown;
    off?: (event: "finish" | "close", listener: () => void) => unknown;
    removeListener?: (event: "finish" | "close", listener: () => void) => unknown;
}
export type ExpressNextFunction = (error?: unknown) => void;
export type ExpressRequestHandler = (req: ExpressRequestLike, res: ExpressResponseLike, next: ExpressNextFunction) => void;
export interface ExpressIntegrationOptions {
    name?: string;
    minStatus?: number;
    captureAll?: boolean;
    captureSuccessful?: boolean;
    captureAborted?: boolean;
    sampleRate?: number;
    random?: () => number;
    bindContext?: boolean;
    captureRequestHeaders?: readonly string[];
    captureResponseHeaders?: readonly string[];
    sanitizeUrl?: (url: string) => string;
    getRequestId?: (req: ExpressRequestLike, res: ExpressResponseLike) => string | undefined;
    getRoute?: (req: ExpressRequestLike) => string | undefined;
    context?: (req: ExpressRequestLike, res: ExpressResponseLike) => Record<string, unknown> | undefined;
    level?: (status: number, req: ExpressRequestLike, res: ExpressResponseLike, aborted: boolean) => LoggerLevel;
}
export declare function expressIntegration(logger: LoggerLike, options?: ExpressIntegrationOptions): ExpressRequestHandler;
```

## fastify-integration.d.ts

```ts
import { type LoggerLevel, type LoggerLike } from "@loggerjs/core";
export interface FastifyRequestLike {
    id?: string;
    method?: string;
    url?: string;
    headers?: Record<string, string | string[] | undefined>;
    ip?: string;
    routeOptions?: {
        url?: string;
    };
    routerPath?: string;
    [key: string]: unknown;
}
export interface FastifyReplyLike {
    statusCode?: number;
    getHeader?: (name: string) => number | string | string[] | undefined;
    [key: string]: unknown;
}
export type FastifyDone = (error?: unknown) => void;
export type FastifyOnRequestHook = (request: FastifyRequestLike, reply: FastifyReplyLike, done: FastifyDone) => void;
export type FastifyOnResponseHook = (request: FastifyRequestLike, reply: FastifyReplyLike, done: FastifyDone) => void;
export type FastifyOnErrorHook = (request: FastifyRequestLike, reply: FastifyReplyLike, error: unknown, done: FastifyDone) => void;
export interface FastifyInstanceLike {
    addHook: (name: "onRequest" | "onResponse" | "onError", hook: FastifyOnRequestHook | FastifyOnResponseHook | FastifyOnErrorHook) => unknown;
}
export type FastifyPluginCallback = (instance: FastifyInstanceLike, options: unknown, done?: FastifyDone) => void;
export interface FastifyIntegrationOptions {
    name?: string;
    minStatus?: number;
    captureAll?: boolean;
    captureSuccessful?: boolean;
    sampleRate?: number;
    random?: () => number;
    bindContext?: boolean;
    captureRequestHeaders?: readonly string[];
    captureResponseHeaders?: readonly string[];
    sanitizeUrl?: (url: string) => string;
    getRequestId?: (request: FastifyRequestLike, reply: FastifyReplyLike) => string | undefined;
    getRoute?: (request: FastifyRequestLike) => string | undefined;
    context?: (request: FastifyRequestLike, reply: FastifyReplyLike) => Record<string, unknown> | undefined;
    level?: (status: number, request: FastifyRequestLike, reply: FastifyReplyLike, error: unknown) => LoggerLevel;
}
export declare function fastifyIntegration(logger: LoggerLike, options?: FastifyIntegrationOptions): FastifyPluginCallback;
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
export * from "./express-integration.js";
export * from "./fastify-integration.js";
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
