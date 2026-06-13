# @loggerjs/core

> Tiny, zero-dependency, isomorphic structured logger core — the foundation every other LoggerJS package builds on.

[![npm](https://img.shields.io/npm/v/@loggerjs/core.svg)](https://www.npmjs.com/package/@loggerjs/core)
[![license](https://img.shields.io/npm/l/@loggerjs/core)](../../LICENSE)
[![dependencies](https://img.shields.io/badge/dependencies-0-44CC11)](package.json)

The platform-neutral heart of [LoggerJS](../../README.md). It has **zero dependencies**, touches **no platform APIs**, and compiles **without DOM libs**, so the same logger code runs in Node, browsers, workers, and edge runtimes. Platform packages (`@loggerjs/node`, `@loggerjs/browser`) re-export everything here and add transports and automatic collection on top.

## Install

```bash
npm install @loggerjs/core
```

Most apps install a platform package instead (`@loggerjs/node` or `@loggerjs/browser`), which bundles this core. Depend on `@loggerjs/core` directly from **libraries** so you can log without forcing a platform choice on your users.

## Usage

```ts
import { consoleTransport, createLogger, defineEvent, withContext } from "@loggerjs/core";

const UserSignedIn = defineEvent<{ userId: string }>({
  type: "user.signed_in",
  message: (event) => `signed in ${event.userId}`,
});

const logger = createLogger({
  category: ["app"],
  level: "info",
  transports: [consoleTransport()],
});

withContext({ requestId: "req_123" }, () => {
  logger.event(UserSignedIn, { userId: "u_123" }); // carries { requestId }
});
```

### Library-safe logging

`getLogger()` is a silent no-op until the host application calls `configure()` — log freely from a library without pulling logging configuration into it.

```ts
import { getLogger } from "@loggerjs/core";

const log = getLogger(["my-lib", "client"]);
log.debug("handshake started"); // no output until the app configures logging
```

## What's included

| Area | Exports |
| --- | --- |
| **Logger & registry** | `createLogger`, `getLogger`, `configure`, child loggers, numeric levels with names |
| **Record/event model** | `LogRecord` (hot path) and `LogEvent` (transport-facing), `recordToEvent` / `eventToRecord` |
| **Context** | `withContext`, `getContext`, `setContextManager`, `addContextProvider` |
| **Typed & semantic events** | `defineEvent`, `semanticEvents` (shared `error` / `http` / `db` / `job` / `ui` / … field families) |
| **Trace propagation** | W3C `traceparent` / `baggage` parse and format helpers |
| **Middleware & integrations** | the synchronous middleware kernel and the `setup(api)` integration API with re-entrancy guards |
| **Transports** | `consoleTransport`, `memoryTransport`, `testTransport`, plus reliability wrappers `batchTransport`, `retryTransport`, `fallbackTransport` |
| **Codecs** | `jsonCodec`, `safeJsonCodec`, `ndjsonCodec`, `metricsCodec` |
| **Diagnostics** | `getLoggerMetaStats`, `getLoggerSelfMetrics` — counters and gauges for every silent degradation (queue drops, codec fallbacks, integration re-entrancy) |

## Subpath exports

Import only what you need; everything is side-effect-free and tree-shakeable.

```
@loggerjs/core/context              @loggerjs/core/transport-console
@loggerjs/core/events               @loggerjs/core/transport-batch
@loggerjs/core/semantic-events      @loggerjs/core/transport-reliability
@loggerjs/core/trace-propagation    @loggerjs/core/transport-test
@loggerjs/core/middleware           @loggerjs/core/codec-json
@loggerjs/core/payload-transforms   @loggerjs/core/codec-metrics
```

## Documentation

- [Concepts](../../docs/CONCEPTS.md) — the pipeline: records, events, middleware, processors, transports, codecs
- [Architecture](../../docs/ARCHITECTURE.md) — invariants, the record fast path, and recorded decisions
- [Getting Started](../../docs/GETTING-STARTED.md) · [LoggerJS root README](../../README.md)

## License

[MIT](../../LICENSE) © JS Kits
