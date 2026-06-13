# @loggerjs/node

> Node.js transports, AsyncLocalStorage context, and 16 automatic integrations — re-exports all of `@loggerjs/core`.

[![npm](https://img.shields.io/npm/v/@loggerjs/node.svg)](https://www.npmjs.com/package/@loggerjs/node)
[![license](https://img.shields.io/npm/l/@loggerjs/node)](../../LICENSE)
[![Node](https://img.shields.io/badge/Node-%E2%89%A522.13-339933?logo=node.js&logoColor=white)](package.json)

The Node platform package for [LoggerJS](../../README.md). It re-exports the entire `@loggerjs/core` API and adds stdout/stderr/file/HTTP/syslog/worker transports, an AsyncLocalStorage context bridge, and integrations that turn process crashes, HTTP frameworks, clients, and queues into structured logs — all opt-in.

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
| `stdoutTransport` / `stderrTransport` | process streams, one NDJSON line per log |
| `fileTransport` / `rotatingFileTransport` | files, with size-based rotation |
| `nodeHttpTransport` | a collector over `fetch`, wrapped in `batchTransport` (batching + retry) |
| `nodeSyslogTransport` | RFC 5424 syslog over UDP/TCP |
| `workerTransport` | a worker thread (encodes batches with a codec, optional buffer transfer, fallback on worker death) |

## Integrations (16)

| Group | Integrations |
| --- | --- |
| **Process & runtime** | `captureProcessIntegration`, `captureCliIntegration`, `diagnosticsChannelIntegration`, `serverlessIntegration` |
| **HTTP frameworks** | `expressIntegration`, `fastifyIntegration`, `koaIntegration`, `hapiIntegration`, `nestMiddlewareIntegration` |
| **Clients** | `nodeFetchIntegration`, `nodeHttpClientIntegration`, `redisIntegration`, `prismaIntegration`, `databaseIntegration` |
| **Queues** | `queueIntegration`, `bullMqIntegration` |

`captureProcessIntegration()` turns uncaught exceptions (fatal), unhandled rejections, warnings, and exit into log events; with `exitOnUncaught` it flushes synchronously before exiting. Every integration is tagged `source: "integration:<name>"` and guarded against capture loops.

### Context manager

```ts
import { installAsyncLocalStorageContext, withContext } from "@loggerjs/node";

installAsyncLocalStorageContext(); // once at startup
await withContext({ requestId: "req_123" }, async () => {
  logger.info("request started"); // { requestId } follows across awaits
});
```

## Subpath exports

Transports — `transport-stdout` · `transport-file` · `transport-rotating-file` · `transport-http` · `transport-syslog` · `transport-worker` · `payload-transforms` · `context`

Integrations — `integration-process` · `integration-cli` · `integration-diagnostics` · `integration-serverless` · `integration-express` · `integration-fastify` · `integration-koa` · `integration-nest` · `integration-hapi` · `integration-fetch` · `integration-http-client` · `integration-redis` · `integration-prisma` · `integration-database` · `integration-queue` · `integration-bullmq`

## Documentation

- [Transports](../../docs/TRANSPORTS.md) · [Integrations](../../docs/INTEGRATIONS.md) · [Operations](../../docs/OPERATIONS.md)
- [Getting Started](../../docs/GETTING-STARTED.md) · [LoggerJS root README](../../README.md)

## License

[MIT](../../LICENSE) © JS Kits
