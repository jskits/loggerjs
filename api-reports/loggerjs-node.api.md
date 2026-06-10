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

## database-integration.d.ts

```ts
import { type Integration, type LoggerLevel } from "@loggerjs/core";
export interface DatabaseClientLike {
    [method: string]: unknown;
}
export interface DatabaseIntegrationTarget {
    client: DatabaseClientLike;
    name?: string;
    system?: string;
    methods?: readonly string[];
}
export interface DatabaseOperationInfo {
    target: string;
    system?: string;
    method: string;
    statement?: string;
}
export interface DatabaseIntegrationOptions {
    client?: DatabaseClientLike;
    targets?: readonly DatabaseIntegrationTarget[];
    name?: string;
    system?: string;
    methods?: readonly string[];
    captureAll?: boolean;
    captureSuccessful?: boolean;
    minDurationMs?: number;
    sampleRate?: number;
    random?: () => number;
    captureParameters?: boolean;
    sanitizeStatement?: (statement: string) => string;
    getStatement?: (args: readonly unknown[], method: string) => string | undefined;
    level?: (durationMs: number, error: unknown, info: DatabaseOperationInfo) => LoggerLevel;
}
export declare function databaseIntegration(options?: DatabaseIntegrationOptions): Integration;
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
export * from "./syslog-transport.js";
export * from "./worker-transport.js";
export * from "./context.js";
export * from "./database-integration.js";
export * from "./express-integration.js";
export * from "./fastify-integration.js";
export * from "./node-fetch-integration.js";
export * from "./node-http-client-integration.js";
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

## node-fetch-integration.d.ts

```ts
import { type Integration, type LoggerLevel } from "@loggerjs/core";
export interface NodeFetchHeadersLike {
    get?: (name: string) => string | null;
    [key: string]: unknown;
}
export interface NodeFetchRequestLike {
    url?: string;
    method?: string;
    headers?: NodeFetchHeadersLike | Record<string, unknown>;
}
export interface NodeFetchInitLike {
    method?: string;
    headers?: NodeFetchHeadersLike | Record<string, unknown>;
}
export interface NodeFetchResponseLike {
    status?: number;
    headers?: NodeFetchHeadersLike | Record<string, unknown>;
}
export type NodeFetchFunction = (input: string | URL | NodeFetchRequestLike, init?: NodeFetchInitLike) => Promise<NodeFetchResponseLike>;
export interface NodeFetchTargetLike {
    fetch?: NodeFetchFunction;
}
export interface NodeFetchRequestInfo {
    method: string;
    url: string;
    requestHeaders?: Record<string, string>;
}
export interface NodeFetchIntegrationOptions {
    name?: string;
    minStatus?: number;
    captureAll?: boolean;
    captureSuccessful?: boolean;
    sampleRate?: number;
    random?: () => number;
    captureRequestHeaders?: readonly string[];
    captureResponseHeaders?: readonly string[];
    sanitizeUrl?: (url: string) => string;
    level?: (status: number | undefined, error: unknown, info: NodeFetchRequestInfo) => LoggerLevel;
    target?: NodeFetchTargetLike;
}
export declare function nodeFetchIntegration(options?: NodeFetchIntegrationOptions): Integration;
```

## node-http-client-integration.d.ts

```ts
import { type Integration, type LoggerLevel } from "@loggerjs/core";
export interface NodeHttpClientRequestLike {
    once?: (event: "response" | "error", listener: (...args: unknown[]) => void) => unknown;
    on?: (event: "response" | "error", listener: (...args: unknown[]) => void) => unknown;
    off?: (event: "response" | "error", listener: (...args: unknown[]) => void) => unknown;
    removeListener?: (event: "response" | "error", listener: (...args: unknown[]) => void) => unknown;
    end?: (...args: unknown[]) => unknown;
}
export interface NodeHttpIncomingMessageLike {
    statusCode?: number;
    headers?: Record<string, number | string | string[] | undefined>;
}
export type NodeHttpRequestFunction = (this: unknown, ...args: unknown[]) => NodeHttpClientRequestLike;
export interface NodeHttpModuleLike {
    request?: NodeHttpRequestFunction;
    get?: NodeHttpRequestFunction;
}
export interface NodeHttpClientRequestInfo {
    protocol: "http:" | "https:" | string;
    method: string;
    url: string;
    requestHeaders?: Record<string, string | string[]>;
}
export interface NodeHttpClientIntegrationOptions {
    name?: string;
    minStatus?: number;
    captureAll?: boolean;
    captureSuccessful?: boolean;
    sampleRate?: number;
    random?: () => number;
    captureRequestHeaders?: readonly string[];
    captureResponseHeaders?: readonly string[];
    sanitizeUrl?: (url: string) => string;
    level?: (status: number | undefined, error: unknown, info: NodeHttpClientRequestInfo) => LoggerLevel;
    httpModule?: NodeHttpModuleLike | null;
    httpsModule?: NodeHttpModuleLike | null;
}
export declare function nodeHttpClientIntegration(options?: NodeHttpClientIntegrationOptions): Integration;
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

## syslog-transport.d.ts

```ts
import { type LogEvent, type LoggerLevel, type Transport } from "@loggerjs/core";
export type NodeSyslogProtocol = "tcp" | "udp4" | "udp6";
export type NodeSyslogTcpFraming = "newline" | "octet-counting";
export interface NodeSyslogUdpSocket {
    send: (message: string | Uint8Array, port: number, host: string, callback?: (error: Error | null | undefined) => void) => void;
    close?: () => void;
    on?: (event: "error", listener: (error: Error) => void) => void;
    unref?: () => void;
}
export interface NodeSyslogTcpSocket {
    write: (message: string | Uint8Array, callback?: (error?: Error | null) => void) => boolean;
    end?: () => void;
    destroy?: () => void;
    on?: (event: "error", listener: (error: Error) => void) => void;
    unref?: () => void;
}
export type NodeSyslogUdpSocketFactory = (protocol: "udp4" | "udp6") => NodeSyslogUdpSocket;
export type NodeSyslogTcpSocketFactory = (options: {
    host: string;
    port: number;
}) => NodeSyslogTcpSocket;
export interface NodeSyslogFormatOptions {
    facility?: number;
    hostname?: string;
    appName?: string | ((event: LogEvent) => string);
    procId?: string | number | ((event: LogEvent) => string | number);
    msgId?: string | ((event: LogEvent) => string);
    structuredData?: string | ((event: LogEvent) => string);
    formatMessage?: (event: LogEvent) => string;
}
export interface NodeSyslogTransportOptions extends NodeSyslogFormatOptions {
    name?: string;
    minLevel?: LoggerLevel;
    protocol?: NodeSyslogProtocol;
    host?: string;
    port?: number;
    tcpFraming?: NodeSyslogTcpFraming;
    unref?: boolean;
    udpSocketFactory?: NodeSyslogUdpSocketFactory;
    tcpSocketFactory?: NodeSyslogTcpSocketFactory;
    onError?: (error: unknown, detail: {
        operation: string;
    }) => void;
}
export declare function formatSyslogMessage(event: LogEvent, options?: NodeSyslogFormatOptions): string;
export declare function nodeSyslogTransport(options?: NodeSyslogTransportOptions): Transport;
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
