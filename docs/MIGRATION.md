# Migration Notes

This page covers migrating from pino, winston, and `console.log`, followed by the LoggerJS conventions that most often surprise people coming from those loggers.

## From pino

Same levels, same numeric values, same NDJSON instinct — the mapping is mostly mechanical.

```ts
// pino
import pino from "pino";
const logger = pino({ level: "info", base: { service: "checkout" } });
logger.info({ orderId: "ord_123" }, "order created");
const child = logger.child({ requestId: "req_1" });

// loggerjs
import { createLogger, stdoutTransport } from "@loggerjs/node";
const logger = createLogger({
  level: "info",
  tags: { service: "checkout" },
  transports: [stdoutTransport()],
});
logger.info("order created", { orderId: "ord_123" }); // message first, data second
const child = logger.child({ bindings: { requestId: "req_1" } });
```

Key differences:

- **Argument order flips**: pino takes `(mergeObject, message)`, LoggerJS takes `(message, data)`. Errors go first in both: `logger.error(err, "msg")`.
- pino `base` fields split into `tags` (stable, low-cardinality) and `bindings` (context fields merged into `context`).
- pino `serializers` become processors (`normalizeErrorProcessor`, `redactProcessor`, custom `enrichProcessor`) — applied to structured data before serialization.
- pino redaction maps to `redactProcessor({ paths, censor, remove })`; `replacement` is the LoggerJS-native name for `censor`, and exact key/path matching is preferred on hot loggers.
- pino `transport`/`destination` becomes a transport: `stdoutTransport()`, `fileTransport()`, `nodeHttpTransport()`.
- pino-pretty's role is `prettyStdoutTransport()` / `prettyStderrTransport()` for terminals, or `prettyConsoleTransport()` for browser DevTools. The core `consoleTransport()` remains a basic local console sink.
- For Pino-shaped NDJSON, use `pinoCompatCodec()` from `@loggerjs/codecs`. Root data merging is opt-in (`mergeData: true`) and reserved key collisions are nested by default instead of overwriting `time`, `level`, `msg`, `pid`, `hostname`, or `err`.
- For the fastest LoggerJS lean envelope, use `fastEventJsonCodec({ includeId: false, includeSeq: false, includeLevelName: false })`. Record-aware custom transports can wrap it with `createPreparedRecordEncoder(codec)` to reuse stable logger/tag fragments. On the M1 Max reference machine the plain lean path measures ~1.19× pino and the prepared lean path ~1.28× (paired A/B; ranking vs pino is CPU/V8-dependent — reproduce with `BENCH_AB`, see [BENCHMARKS.md](BENCHMARKS.md)); on top of that throughput you get middleware, integrations, multi-transport fan-out, and an isomorphic browser story.

## From winston

```ts
// winston
import winston from "winston";
const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  defaultMeta: { service: "checkout" },
  transports: [new winston.transports.Console(), new winston.transports.File({ filename: "app.log" })],
});

// loggerjs
import { createLogger, fileTransport, stdoutTransport } from "@loggerjs/node";
const logger = createLogger({
  level: "info",
  tags: { service: "checkout" },
  transports: [stdoutTransport(), fileTransport({ path: "app.log" })],
});
```

Key differences:

- winston `format` chains split into two concerns: **processors/middleware** (data shaping: redact, enrich, filter) and **codecs** (serialization, owned by each transport). `format.combine(timestamp, json)` is simply the default output.
- `defaultMeta` → `tags` and/or `bindings`.
- Per-transport `level` maps directly to `minLevel` on any transport.
- Child loggers replace `winston.loggers` registries for per-module configuration; library authors should prefer `getLogger()` from core.
- In the sequential benchmark suite, the lean LoggerJS path measures roughly 10x winston's throughput ([BENCHMARKS.md](BENCHMARKS.md)).

## From console.log

Two migration styles, usable together.

**Capture first, migrate incrementally** — turn existing console calls into structured logs without touching call sites:

```ts
import { captureConsoleIntegration, createLogger, browserHttpTransport } from "@loggerjs/browser";

const logger = createLogger({
  transports: [browserHttpTransport({ url: "/api/logs" })],
  integrations: [captureConsoleIntegration({ levels: ["log", "warn", "error"] })],
});
```

**Then replace call sites** where structure pays off:

```ts
// before
console.log("order created", orderId);
console.error("payment failed", err);

// after
logger.info("order created", { orderId });
logger.error(err, "payment failed");
```

What you gain at each step: levels and level gating, structured data instead of interpolated strings, redaction before anything leaves the process, batching/offline delivery, and crash-path capture via the error/process integrations.

---

## Middleware and Processors

LoggerJS has two synchronous shaping layers, and both are first-class:

- **Middleware** runs on the raw `LogRecord` before ids, messages, or errors are computed. It is the cheapest place to enrich, redact, or drop, and it keeps the record fast path.
- **Processors** run on the projected `LogEvent`. Use them when you need the resolved event shape, for example routing, fingerprinting, or fingers-crossed buffering. Any processor disables the record fast path for that logger.

`@loggerjs/processors` ships both flavors, such as `tagsMiddleware()` and `tagsProcessor()`. Write your own middleware with `createMiddleware()`:

```ts
import { createMiddleware } from "@loggerjs/core/middleware";
import { redactProcessor, tagsMiddleware } from "@loggerjs/processors";

const logger = createLogger({
  middleware: [tagsMiddleware({ service: "checkout" })],
  processors: [redactProcessor()],
});
```

See [CONCEPTS.md](CONCEPTS.md) for the full model.

## Context

Use child loggers for context known when the logger is created:

```ts
const requestLogger = logger.child({ bindings: { requestId: "req_123" } });
```

Use ambient context for request scopes:

```ts
import { withContext } from "@loggerjs/core";
import { installAsyncLocalStorageContext } from "@loggerjs/node";

installAsyncLocalStorageContext();
await withContext({ requestId: "req_123" }, async () => {
  logger.info("request started");
});
```

## Browser Integrations

Browser collection is opt-in. Existing manual logging code does not capture console calls, errors, fetch, or XHR until the matching integration is configured.

A typical starting set:

```ts
captureConsoleIntegration({ levels: ["warn", "error"] });
captureBrowserErrorsIntegration();
captureFetchIntegration();
pageLifecycleIntegration();
```

## Transports and Codecs

Serialization belongs to transports. Move JSON or string formatting out of middleware and processors and into a transport codec:

```ts
browserHttpTransport({ url: "/api/logs", codec: safeJsonCodec() });
```

When you write a custom transport, implement `write`/`writeBatch` to receive `LogRecord`s on the fast path, or `log`/`logBatch` to receive projected `LogEvent`s. Wrap anything that does network I/O in `batchTransport()` for queue bounds, retry, byte limits, concurrency, and circuit breaking. See [TRANSPORTS.md](TRANSPORTS.md#writing-a-custom-transport).

## Imports Leaving the Core Root in 1.0

The `@loggerjs/core` root keeps only the kernel in 1.0. Since 0.7 the exports below still work from the root but are marked `@deprecated`, so editors flag them; import them from their subpath instead:

| Exports | Import from |
| --- | --- |
| `parseTraceparent`, `formatTraceparent`, `parseBaggage`, `formatBaggage`, `traceContextFromHeaders`, `traceContextToHeaders` | `@loggerjs/core/trace-propagation` |
| `semanticEvents` and the `Semantic*Payload` types | `@loggerjs/core/semantic-events` |
| `applyPayloadTransforms`, `composePayloadTransforms`, `encryptionPayloadTransform`, `encodedPayloadToUint8Array` | `@loggerjs/core/payload-transforms` |
| `setLoggerDiagnosticSink`, `runLoggerDiagnostic`, `emitLoggerDiagnostic`, `loggerDiagnosticsEnabled`, `loggerDiagnosticNow` | `@loggerjs/core/diagnostics` |
| `createIntegrationSetupContext`, `getUnpatchedRegistry`, `registerUnpatchedDefaults`, `onceTeardown` | `@loggerjs/core/integration-api` |
| `withLogEventRoute`, `getLogEventRoute`, `LOGGERJS_ROUTE` | `@loggerjs/core/event-route` |
| `metricsCodec` | `@loggerjs/core/codec-metrics` |
| `createPreparedRecordEncoder` | `@loggerjs/core/codec-prepared` |
| `testTransport` and its option types | `@loggerjs/core/transport-test` |

The `Integration`, `IntegrationSetupContext`, `Transport`, `Codec`, and other pipeline types stay in the root.

## Package Imports

Root package imports work everywhere:

```ts
import { createLogger } from "@loggerjs/core";
```

Subpaths give narrower imports:

```ts
import { createMiddleware } from "@loggerjs/core/middleware";
import { browserHttpTransport } from "@loggerjs/browser/transport-http";
import { stdoutTransport } from "@loggerjs/node/transport-stdout";
```

Every package publishes ESM and CJS entry points, and the type declarations are checked against NodeNext package resolution.
