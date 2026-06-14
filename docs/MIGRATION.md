# Migration Notes

LoggerJS is still pre-1.0, but the current codebase has moved from the initial skeleton toward the v1 architecture. The first half of this page covers migrating from other loggers; the second half covers vocabulary changes inside LoggerJS itself.

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
- pino-pretty's role is `prettyStdoutTransport()` / `prettyStderrTransport()`
  for terminals, or `prettyConsoleTransport()` for browser DevTools. The core
  `consoleTransport()` remains a basic local console sink.
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
- Throughput on the fastest comparable path measures roughly 11x winston in the current snapshot ([BENCHMARKS.md](BENCHMARKS.md)).

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

## Processor To Middleware Vocabulary

The `@loggerjs/processors` package remains supported for compatibility. New docs describe this layer as synchronous middleware because the behavior is broader than event processors: redaction, enrichment, sampling, tags, type, dedupe, and trace attachment all run before transport delivery.

Existing code can continue to use:

```ts
import { redactProcessor } from "@loggerjs/processors";
```

New core middleware can use:

```ts
import { createMiddleware } from "@loggerjs/core/middleware";
```

## LogEvent And LogRecord

`LogEvent` remains the transport-facing compatibility shape. Core record helpers now use `LogRecord` internally so the hot path can preserve lazy messages, raw errors, bound context, and stable record shape before projecting to transport events.

Transport authors should keep accepting `LogEvent` through the current public `Transport` interface. Codec authors should use the exported codec input helpers rather than reaching into logger internals.

## Context

Use child loggers for explicit context:

```ts
const requestLogger = logger.child({ requestId: "req_123" });
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

Browser collection remains opt-in. Existing manual logging code does not automatically capture console, errors, fetch, or XHR until the matching integration is configured.

Prefer:

```ts
captureConsoleIntegration({ levels: ["warn", "error"] });
captureBrowserErrorsIntegration();
captureFetchIntegration();
pageLifecycleIntegration();
```

## Transports And Codecs

Serialization belongs to transports. Move JSON/stringification work out of processors and into a transport codec:

```ts
browserHttpTransport({ url: "/api/logs", codec: safeJsonCodec() });
```

Batch-based transports now share queue, retry, byte-limit, concurrency, and circuit-breaker options.

## Package Imports

Root package imports still work:

```ts
import { createLogger } from "@loggerjs/core";
```

Stable subpaths are available for narrower imports:

```ts
import { createMiddleware } from "@loggerjs/core/middleware";
import { browserHttpTransport } from "@loggerjs/browser/transport-http";
import { stdoutTransport } from "@loggerjs/node/transport-stdout";
```

The current build publishes both ESM and CJS entry points. Type declarations are checked against NodeNext-style package resolution.
