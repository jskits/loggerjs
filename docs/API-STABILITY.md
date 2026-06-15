# API Stability

LoggerJS is currently pre-1.0, but the project already has a v1-oriented public
surface. This page defines the **stable API subset** that applications can build
on with low migration risk, and the areas that may still change before v1.

The checked-in `api-reports/` files are the mechanical source of truth for the
published TypeScript surface. This document is the human stability contract.

## Current Stabilization Phase

Before v1, the project is prioritizing confidence in the existing public surface
over adding more built-in transports or integrations. New public component
subpaths are allowed only when the change also defines their stability level,
documents runtime and delivery caveats, updates import-boundary docs, keeps size
budgets honest, and adds validation at the closest practical environment level
(unit, browser E2E, runtime smoke, Docker-backed live service, or external
provider smoke).

If a use case can be solved by composing existing transports, processors,
codecs, or wrappers, prefer documentation and examples over a new core/built-in
component.

## Change Policy

For the stable subset below:

- No intentional removals, renames, or signature breaks before v1 without a
  deprecation note and migration path.
- Additive changes are allowed: new options, new fields, new overloads, new
  transports, and new integrations.
- Defaults that affect delivery, privacy, or performance require documentation
  and release notes.
- Security fixes, data-loss fixes, and vendor wire-protocol correctness fixes
  may change edge-case behavior. The release notes must call those out.

For everything outside the stable subset, the TypeScript declarations are still
tested and API-reported, but minor releases may adjust names, options, or exact
payload mapping before v1.

## Stable for v1

### Package Entry Points

These package names and documented root imports are part of the v1 contract:

- `@loggerjs/core`
- `@loggerjs/browser`
- `@loggerjs/node`
- `@loggerjs/pretty`
- `@loggerjs/processors`
- `@loggerjs/codecs`
- `@loggerjs/otel`
- `@loggerjs/sentry`
- `@loggerjs/datadog`
- `@loggerjs/elastic`
- `@loggerjs/loki`
- `@loggerjs/cloudwatch`
- `@loggerjs/database`

Documented subpath exports are intended to remain valid, but users should prefer
root package imports unless they need a precise tree-shaking boundary. Internal
source paths and `dist` file paths are not public API.

### Core Logger Model

Stable:

- `createLogger(options)` and the `Logger` instance methods:
  `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `log`, `capture`,
  `event`, `child`, `withTags`, `withType`, `setLevel`, `getLevel`,
  `isEnabled`, `isLevelEnabled`, `addTransport`, `addProcessor`,
  `addIntegration`, `ready`, `flush`, `flushSync`, and `close`.
- `getLogger(category)` and `configure(...)` for library-safe logging that stays
  silent until the host application configures output.
- Level names and numeric values: `trace=10`, `debug=20`, `info=30`,
  `warn=40`, `error=50`, `fatal=60`, and `silent`.
- Category arrays, child bindings, tags, `withContext()`, context providers,
  and the Node AsyncLocalStorage bridge.
- `defineEvent()` typed events and the `(message, data)`,
  `(error, message, data)`, and lazy-message call forms.

Stable semantics:

- Disabled levels return before record allocation and message evaluation.
- Logger internals never throw into application code; middleware, processors,
  codecs, integrations, and transports are error-isolated.
- Objects passed as `data` / `props` are not deep-snapshotted by default. Clone
  before logging when later mutation must not affect deferred transports.

### Pipeline Contracts

Stable:

- `Middleware`: synchronous `LogRecord -> LogRecord | null`.
- `Processor`: synchronous `LogEvent -> LogEvent | false | void`.
- `Transport`: `ready`, `write`, `writeBatch`, `log`, `logBatch`, `flush`,
  `flushSync`, `close`, `name`, and `minLevel`.
- `TransportContext.toEvent(record)` memoizes projection so several transports
  share one event id.
- `Integration`: opt-in `setup(api)` plus teardown.
- Integration setup helpers: `api.capture`, direct log methods, `api.guard`,
  `api.unpatched`, `api.flush`, `api.flushSync`, and `api.close`.
- `Codec`: `encode`, optional `decode`, and optional
  `prepareRecordEncoder`.

Stable boundary rule:

- Serialization belongs to the transport codec. Middleware and processors should
  keep values structured and must not pre-stringify for a destination.

### Core Transports and Codecs

Stable:

- `consoleTransport`
- `memoryTransport`
- `testTransport`
- `batchTransport`
- `retryTransport`
- `fallbackTransport`
- `jsonCodec`
- `safeJsonCodec`
- `ndjsonCodec`
- `metricsCodec`
- `createPreparedRecordEncoder`

The exact performance of these helpers is not API, but their high-level
semantics, error isolation, and option names are part of the v1 contract.

### Browser Production Surface

Stable:

- `browserHttpTransport`
- `memoryBrowserHttpOfflineQueue`
- `indexedDbBrowserHttpOfflineQueue`
- `indexedDbTransport`
- `offlineFirstTransport`
- `pageLifecycleIntegration`
- `captureConsoleIntegration`
- `captureBrowserErrorsIntegration`
- `captureFetchIntegration`
- `captureXHRIntegration`
- `captureWebVitalsIntegration`
- `capturePerformanceIntegration`

Stable semantics:

- Browser integrations are opt-in and teardown-capable.
- Browser HTTP delivery is best effort unless the remote endpoint acknowledges
  the payload.
- IndexedDB persistence survives reloads only while browser storage remains
  available, permitted, and not evicted.

### Node Production Surface

Stable:

- `stdoutTransport`
- `stderrTransport`
- `fileTransport`
- `rotatingFileTransport`
- `nodeHttpTransport`
- `nodeSyslogTransport`
- `workerTransport`
- `captureProcessIntegration`
- `installAsyncLocalStorageContext`
- `createAsyncLocalStorageContextManager`
- `installLoggerDiagnosticsChannel`

Stable semantics:

- `stdoutTransport` / `stderrTransport` are drain-aware and ignore `EPIPE` by
  default.
- `fileTransport().flushSync()` is a crash-path primitive.
- `captureProcessIntegration({ exitOnUncaught })` captures fatal errors,
  performs sync-capable flushes, waits for bounded async flush, then exits.
- `workerTransport()` remains an object-message worker API with optional ready
  and ack lifecycles.

### Pretty Developer UX Surface

Stable:

- `formatPrettyEvent`
- `prettyConsoleTransport`
- `prettyStreamTransport`
- `prettyStdoutTransport`
- `prettyStderrTransport`

Stable semantics:

- Pretty output is transport-owned display behavior. It does not mutate the
  record/event pipeline and does not replace structured production transports.
- `prettyConsoleTransport()` writes through the unpatched console registry and
  filters console-capture loop events by default.
- `prettyStdoutTransport()` / `prettyStderrTransport()` honor `NO_COLOR`,
  `FORCE_COLOR`, `minLevel`, and stream `drain` for async `flush()`.

Compatible but tunable:

- Exact colors, spacing, label width, and compact/expanded layout may be refined
  before v1 as long as option names and high-level behavior remain.

### Processors and Middleware

Stable:

- `redactProcessor`
- `privacyGuardProcessor`
- `normalizeErrorProcessor`
- `stackParserProcessor`
- `tagsProcessor` / `tagsMiddleware`
- `typeProcessor` / `typeMiddleware`
- `contextProcessor` / `contextMiddleware`
- `enrichProcessor` / `enrichMiddleware`
- `traceContextProcessor` / `traceContextMiddleware`
- `sampleProcessor`
- `rateLimitProcessor`
- `dedupeProcessor`
- `filterProcessor`
- `routeProcessor`
- `levelOverrideProcessor`
- `fingerprintProcessor`
- `fingersCrossedProcessor`
- `breadcrumbBufferProcessor`

Stable semantics:

- Processors are synchronous and error-isolated.
- Privacy processors may add new built-in patterns or safer defaults in minor
  releases, but existing option names remain.
- Sampling/rate-limit internals may be tuned, but configured rates, caps, and
  drop hooks keep their meaning.

### Codecs and Observability Packages

Stable:

- `fastEventJsonCodec`
- `msgpackrCodec`
- `pinoCompatCodec` / `pinoNdjsonProjector`
- `projectorCodec`
- `otlpHttpTransport`
- `otlpJsonCodec`
- `openTelemetryTraceProcessor`
- `openTelemetryLogBridgeTransport`
- `sentryTransport`
- `datadogLogsTransport`
- `elasticTransport`
- `lokiTransport`
- `cloudWatchLogsTransport`
- `databaseTransport`
- `sqliteTransport`
- `postgresTransport`

Stable semantics:

- Vendor transports speak the documented wire protocol directly or use the
  application-provided SDK/provider object.
- Raw Datadog, Elastic, Loki, and CloudWatch transports are not durable by
  themselves; use `batchTransport()` / `retryTransport()` when production
  delivery needs queueing and backoff.
- Pino compatibility is scoped to common NDJSON shape, not every Pino
  serializer or formatter edge case.

## Compatible but Tunable

These are public, tested, and documented, but exact output details may evolve in
minor releases:

- Browser framework/router adapters, service worker integration, runtime host
  integration, WebSocket integration, user-action integration, and
  BroadcastChannel transport.
- Node framework/data integrations for Express, Fastify, Koa, Nest, Hapi,
  fetch/http clients, diagnostics channel, CLI, serverless, queues, BullMQ,
  generic database clients, Prisma, and Redis.
- Vendor-specific document fields that are not required by the target wire
  protocol.
- Meta counter and diagnostic event names outside the documented common names in
  `TRANSPORTS.md`.
- Benchmark snapshots and benchmark ratios.

## Not Stable Before v1

Avoid depending on these as compatibility contracts:

- Exact `dist` file layout, generated bundle structure, source file paths, and
  private class fields.
- The exact order of object keys in serialized output, except where a codec
  explicitly documents a wire format.
- Internal hidden-class/field-order optimizations on `LogRecord`.
- Undocumented helper behavior inferred from tests but not described in docs or
  API reports.
- Experimental runtime-specific behavior gated by feature detection, such as
  Storage Buckets availability or browser lifecycle timing.

## How to Evaluate a Future Upgrade

1. Read the package changelog and release notes.
2. Run `pnpm check` in this repository if you are contributing, or your
   application test suite if you are consuming LoggerJS.
3. For hot paths, reproduce your relevant benchmark with `pnpm bench:node` or
   `pnpm bench:browser`.
4. For remote delivery, test your actual collector/vendor endpoint and monitor
   `transport.dropped.*`, `transport.retry.*`, and queue-depth metrics.
