# @loggerjs/node

> Node.js transports, AsyncLocalStorage context, and 16 automatic integrations — re-exports all of `@loggerjs/core`.

[![npm](https://img.shields.io/npm/v/@loggerjs/node.svg)](https://www.npmjs.com/package/@loggerjs/node)
[![license](https://img.shields.io/npm/l/@loggerjs/node)](../../LICENSE)
[![Node runtime](https://img.shields.io/badge/runtime_Node-%E2%89%A520.19-339933?logo=node.js&logoColor=white)](../../.github/workflows/ci.yml)

The Node platform package for [LoggerJS](../../README.md). It re-exports the entire `@loggerjs/core` API and adds stdout/stderr/file/HTTP/syslog/worker transports, an AsyncLocalStorage context bridge, and integrations that turn process crashes, HTTP frameworks, clients, and queues into structured logs — all opt-in.

`@loggerjs/node` is smoke-tested from packed packages on Node 20.19.0, 22, and
24. The repository development toolchain uses Node >=22.13.0; that root
requirement does not raise the published package runtime floor.

## Install

```bash
npm install @loggerjs/node @loggerjs/processors
```

`@loggerjs/processors` is optional but recommended for redaction, sampling, and enrichment.

## Usage

```ts
import {
  captureProcessIntegration,
  createLogger,
  installAsyncLocalStorageContext,
  nodeCompressionPayloadTransform,
  nodeFetchIntegration,
  nodeHttpClientIntegration,
  nodeHttpTransport,
  stdoutTransport,
} from "@loggerjs/node";

installAsyncLocalStorageContext(); // once at startup — context follows async execution

const logger = createLogger({
  category: ["api"],
  level: "info",
  tags: { service: "checkout", env: process.env.NODE_ENV ?? "dev" },
  transports: [
    stdoutTransport(), // one NDJSON line per log
    nodeHttpTransport({
      url: "https://collector.example/logs",
      transformPayload: nodeCompressionPayloadTransform({ format: "brotli" }),
    }),
  ],
  integrations: [captureProcessIntegration(), nodeHttpClientIntegration(), nodeFetchIntegration()],
});

logger.info("server started", { port: 3000 });
await logger.flush();
```

### HTTP frameworks

```ts
app.use(expressIntegration(logger, { captureAll: true }));     // Express middleware
fastify.register(fastifyIntegration(logger, { captureAll: true })); // Fastify plugin
```

### Other destinations

```ts
import { nodeSyslogTransport, rotatingFileTransport } from "@loggerjs/node";

nodeSyslogTransport({ host: "127.0.0.1", port: 514, facility: 16 });
rotatingFileTransport({ path: "audit.log", maxBytes: 10 * 1024 * 1024 });
```

## Transports

| Transport | Delivers to |
| --- | --- |
| `stdoutTransport` / `stderrTransport` | process streams, one NDJSON line per log, drain-aware flush, optional `minLength` buffering, clean `EPIPE` shutdown |
| `fileTransport` / `rotatingFileTransport` | files, with `mkdir`/`append` controls, optional `sync: true`, crash-path `flushSync`, and size-based rotation |
| `nodeHttpTransport` | a collector over `fetch`, wrapped in `batchTransport` (batching + retry) |
| `nodeSyslogTransport` | RFC 5424 syslog over UDP/TCP |
| `workerTransport` | a worker thread (encodes batches with a codec, optional buffer transfer, ready/ack lifecycle, fallback on worker failure) |

File and process-stream transports share the same internal destination logic for
write callbacks, drain waiting, `minLength` buffering, close, and sync crash
flush. Use `await flush()` for normal shutdown. Use `flushSync()` only on fatal
paths, or configure `fileTransport({ sync: true })` when every write must reach
the filesystem before the log call returns.

`workerTransport()` is fire-and-forget unless you opt into lifecycle checks.
Use `readyTimeoutMs` for workers that send `{ type: "loggerjs:ready" }`, and
`ackTimeoutMs` for workers that acknowledge `{ type: "loggerjs:batch", id }`
with `{ type: "loggerjs:batch:ack", id }`. Pending batches fall back or are
counted as drops when readiness, posting, ack, or worker exit fails. Set
`autoEnd: false` for shared workers you close elsewhere. Explicit
`transport.ready()` / `logger.ready()` waits for the ready handshake when
`readyTimeoutMs` is configured.

Call `installLoggerDiagnosticsChannel()` to publish LoggerJS internal
diagnostics to Node `diagnostics_channel` channels such as `loggerjs.dispatch`,
`loggerjs.transport`, `loggerjs.flush`, `loggerjs.encode`, and
`loggerjs.worker`.

## Integrations (16)

| Group | Integrations |
| --- | --- |
| **Process & runtime** | `captureProcessIntegration`, `captureCliIntegration`, `diagnosticsChannelIntegration`, `serverlessIntegration` |
| **HTTP frameworks** | `expressIntegration`, `fastifyIntegration`, `koaIntegration`, `hapiIntegration`, `nestMiddlewareIntegration` |
| **Clients** | `nodeFetchIntegration`, `nodeHttpClientIntegration`, `redisIntegration`, `prismaIntegration`, `databaseIntegration` |
| **Queues** | `queueIntegration`, `bullMqIntegration` |

`captureProcessIntegration()` turns uncaught exceptions (fatal), unhandled rejections, warnings, and exit into log events; with `exitOnUncaught` it captures the fatal record, calls `flushSync()`, waits for bounded async `flush()`, then exits. Every integration is tagged `source: "integration:<name>"` and guarded against capture loops.

Coverage notes: `prismaIntegration()` wraps `$queryRaw` / `$executeRaw` raw-query variants only; it does not subscribe to `$on("query")` or capture typed model calls. `bullMqIntegration()` wraps Queue-like `add`, `addBulk`, and legacy `process` methods; it does not hook `Worker` or `QueueEvents` completed/failed/stalled events. `nestMiddlewareIntegration()` is Express-compatible middleware, not a Nest exception-filter/interceptor integration.

### Context manager

```ts
import { installAsyncLocalStorageContext, withContext } from "@loggerjs/node";

installAsyncLocalStorageContext(); // once at startup
await withContext({ requestId: "req_123" }, async () => {
  logger.info("request started"); // { requestId } follows across awaits
});
```

## Subpath exports

Transports — `transport-stdout` · `transport-file` · `transport-rotating-file` · `transport-http` · `transport-syslog` · `transport-worker` · `payload-transforms` · `logger-diagnostics` · `context`

Integrations — `integration-process` · `integration-cli` · `integration-diagnostics` · `integration-serverless` · `integration-express` · `integration-fastify` · `integration-koa` · `integration-nest` · `integration-hapi` · `integration-fetch` · `integration-http-client` · `integration-redis` · `integration-prisma` · `integration-database` · `integration-queue` · `integration-bullmq`

## Documentation

- [Transports](../../docs/TRANSPORTS.md) · [Integrations](../../docs/INTEGRATIONS.md) · [Operations](../../docs/OPERATIONS.md)
- [Getting Started](../../docs/GETTING-STARTED.md) · [LoggerJS root README](../../README.md)

## License

[MIT](../../LICENSE) © JS Kits
