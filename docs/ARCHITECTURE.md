# LoggerJS Architecture

LoggerJS is an isomorphic structured logger for browsers, Node.js, Bun, Deno, workers, and edge runtimes. This page describes how the current packages are put together, the rules the implementation keeps, and the decisions behind the hot path. Exact types live in the package declarations and [API reports](reference/api/index.md).

The product is built around three user-facing concepts:

- **Integration**: opt-in automatic collection, such as browser console capture, global script errors, fetch/XHR failures, page lifecycle flushing, Node process errors, HTTP frameworks, queues, and database clients.
- **Middleware and processors**: synchronous transforms and filters, such as redaction, sampling, enrichment, dedupe, fingerprinting, routing, and fingers-crossed buffering.
- **Transport**: the destination boundary, such as console, stdout, files, HTTP, IndexedDB, OTLP, Sentry, databases, worker threads, or a custom sink.

One more technical boundary is first-class: the **codec**. A codec belongs to a transport and owns serialization. Middleware and processors never serialize; the console transport keeps raw values; HTTP, file, and OTLP transports choose the codec they need.

## Package Layout

```txt
packages/core        Logger, LogRecord/LogEvent model, registry, context, typed and semantic events,
                     middleware kernel, integration API, console/memory/test/batch/retry/fallback
                     transports, json/safe-json/ndjson/metrics codecs, payload transforms
packages/browser     HTTP, IndexedDB, WebSocket, service worker, BroadcastChannel, and offline-first
                     transports, offline queues, ZIP export, 19 browser integrations
packages/node        stdout/stderr/file/rotating-file/HTTP/syslog/worker transports,
                     AsyncLocalStorage context, diagnostics_channel bridge, 16 Node integrations
packages/pretty      Browser DevTools and terminal display transports plus the shared formatter
packages/processors  Runtime-neutral middleware and processor catalog
packages/codecs      fast-event-json, Pino-compatible, msgpackr, and projector codecs
packages/otel        OTLP JSON mapping, OTLP/HTTP transport, log bridge, active-span trace processor
packages/sentry      Sentry structured logs, breadcrumbs, and exception/message capture
packages/datadog|elastic|loki|cloudwatch   Vendor wire transports
packages/database    SQLite, Postgres, and custom-adapter batch transports
```

The browser and Node packages re-export core. Their root entries are convenience presets; every transport and integration also has its own subpath export (for example `@loggerjs/browser/transport-http` or `@loggerjs/node/integration-process`), built as a physical entry bundle and checked by `pnpm verify:entry-boundaries`. See [API Stability](API-STABILITY.md) for which entries are stable.

## Design Rules

1. **Core is platform-neutral.** `@loggerjs/core` does not import browser, Node, Bun, Deno, worker, filesystem, fetch, or diagnostics APIs, and its public types compile without `lib.dom`. Runtime features are detected through `globalThis`.
2. **Disabled logging is almost free.** A disabled level call does one numeric comparison and returns before record allocation, message evaluation, context lookup, or integration work.
3. **Serialization happens only at the transport boundary.** The pipeline keeps raw references. `resolveMessage(record)` is the only lazy evaluation middleware may trigger.
4. **Middleware and processors are synchronous.** No promises, no Koa-style `next`, and no async lookups in the hot path.
5. **Integrations use the same pipeline as manual logs.** Captured records differ only by `source`; they still pass through middleware, processors, routing, codecs, and transports.
6. **Integrations are explicit and reversible.** Every patch is opt-in, guarded against re-entry, and torn down on `close()`.
7. **Logger errors never reach application code.** Failures in middleware, processors, codecs, integrations, and transports are counted in logger meta and reported through `onInternalError` (or `console.error` from the unpatched console when no handler is set).
8. **No object pool.** Short-lived records stay young-generation GC objects.
9. **No generated code.** Redaction and codecs are interpreter-based; nothing uses `eval` or `new Function`.

## End-to-End Pipeline

```txt
manual API / integration capture
        |
        v
  level gate                     one numeric comparison
        |
        v
  createRecord()                 LogRecord with raw message, error, props, context
        |
        v
  middleware                     sync, ordered; may replace fields or drop (null)
        |
        +-- no processors -------> record fast path: transports get the record
        |
        v
  project to LogEvent            id, resolved message, normalized error
        |
        v
  processors                     sync, ordered; may return a new event or drop (false)
        |
        v
  transport fan-out              per-transport minLevel and processor routes
        |
        v
  transport                      own queueing, batching, retry, codec, and delivery
```

The record is never stringified before the chosen transport is ready to ship it. That is what lets the console keep interactive objects, HTTP choose JSON or binary, files write NDJSON, and OTLP apply its own mapping without penalizing other destinations.

## Record Model

`LogRecord` is the hot-path shape. It is built by a single `createRecord()` path that assigns every field in the same order, including `null` fields, so records share one hidden class:

```ts
interface LogRecord {
  time: number;
  level: number;
  category: readonly string[];
  type: string | null;
  tags: Tags | null;
  trace: TraceContext | null;
  msg: string | null;
  lazy: (() => string) | null;
  props: Record<string, unknown> | null;
  err: unknown;
  ctx: BoundContext | null;
  source: string;
  stack: string | null;
  seq: number;
}
```

- Fields are never deleted and no ad hoc properties are attached; extra data belongs in `props` or immutable `ctx`.
- `time` comes from the logger clock; ordering within equal timestamps uses `seq`.
- `err` stays separate from `props` because error normalization, stack truncation, cause handling, and dedupe are specialized.
- `ctx` and logger-level `tags` are frozen and shared. Middleware replaces them (`record.tags = { ...record.tags, extra }`) instead of mutating them.
- There is no `id` on the record. Ids are assigned when a record is projected to a `LogEvent`; codecs that encode records directly use `defaultRecordId`.

`LogEvent` is the transport-facing envelope (`id`, `time`, `seq`, `level`, `levelName`, `logger`, `message`, `type`, `tags`, `data`, `error`, `context`, `trace`, `source`). `recordToEvent()` and `eventToRecord()` convert between the two; [Concepts](CONCEPTS.md) lists the documented lossy cases.

## Logger API

LoggerJS supports two acquisition models. Applications create loggers directly:

```ts
const log = createLogger({
  category: ["app"],
  level: "info",
  transports: [consoleTransport()],
});
```

Libraries look loggers up by category and stay silent until the application configures the registry:

```ts
const log = getLogger(["library", "parser"]);

await configure({
  processors: [redactProcessor({ keys: ["password", /token/i] })],
  transports: {
    console: consoleTransport(),
    http: browserHttpTransport({ url: "/v1/logs", codec: jsonCodec() }),
  },
  loggers: [
    { category: ["app"], level: "debug", transports: ["console", "http"] },
    { category: ["library"], level: "warn", transports: ["http"] },
  ],
  integrations: [captureConsoleIntegration(), captureBrowserErrorsIntegration()],
});
```

Call forms:

```ts
log.info("user logged in", { userId: 42 });
log.error(err, "save failed", { orderId });
log.debug(() => expensiveDebugMessage());
log.event(CheckoutCompleted, { orderId, amountCents });
log.child({ bindings: { requestId } }).warn("retrying");
await log.flush();
```

The overload rule stays small:

- first argument `string`: message
- first argument `function`: lazy message
- otherwise: error slot, with an optional message and props

Core has no printf-style formatting. Structured fields are first-class; formatting is a display concern handled by `@loggerjs/pretty`.

## Registry and Configuration

`getLogger(category)` returns a `RegistryLogger`. Before `configure()` runs it is a no-op; afterwards each call resolves to a cached runtime logger built from the current configuration snapshot.

- Routes match by category prefix, and the most specific route wins: `["app"]` applies to `["app", "checkout"]` unless a longer route matches.
- Transports are named (an object, or an array keyed by each transport's `name`); routes select them by name and fall back to all transports.
- Global processors run before route processors.
- Integrations configured through `configure()` are installed once on an internal host logger.
- Calling `configure()` again replaces the previous snapshot: its integrations are torn down before the new ones are installed, and transports the new configuration no longer references are closed. Transports passed again stay open.
- `configure({ reset: true })` closes every previous integration and transport, including reused ones, before installing the new snapshot.
- The configuration is stored as a snapshot, so log calls do not walk mutable configuration.

The registry is what lets third-party libraries log without coupling to a backend or forcing application configuration.

## Context

There are two context modes:

- **Explicit context** through `logger.child({ bindings })`. Bindings are flattened and frozen when the child is created.
- **Ambient context** through `withContext(bindings, fn)`. The default context manager covers synchronous scopes; `installAsyncLocalStorageContext()` from `@loggerjs/node` carries context across `await` in Node. Browsers stay on synchronous scopes until TC39 AsyncContext is available.

`addContextProvider()` lets integrations contribute ambient fields (trace, session, request id) without replacing the application's provider. When no context providers are registered, `getContext()` returns the managed context without allocating.

## Middleware and Processors

```ts
interface Middleware {
  readonly name: string;
  process(record: LogRecord, context: MiddlewareContext): LogRecord | null;
}

type Processor = (event: LogEvent, context: ProcessorContext) => LogEvent | false | void;
```

- Middleware runs on records before any id, message, or error work. Returning `null` drops the record.
- Processors run on projected events. Returning `false` drops the event; returning an event replaces it.
- Both are error-isolated: an exception is reported and counted, and the pipeline continues.
- Configuring any processor disables the record fast path for that logger, because every log must then be projected.

Middleware must not call `JSON.stringify`, `String(record.props)`, or recursively normalize whole records. If it needs the message it calls `resolveMessage(record)` explicitly. The runtime-neutral catalog lives in `@loggerjs/processors`; see [Processors](PROCESSORS.md).

## Transports

```ts
interface Transport {
  name?: string;
  minLevel?: LoggerLevel;
  ready?(): void | Promise<void>;
  write?(record: LogRecord, context: TransportContext): void | Promise<void>;
  writeBatch?(records: LogRecord[], context: TransportContext): void | Promise<void>;
  log?(event: LogEvent, context: TransportContext): void | Promise<void>;
  logBatch?(events: LogEvent[], context: TransportContext): void | Promise<void>;
  flush?(): void | Promise<void>;
  flushSync?(): void;
  close?(): void | Promise<void>;
}
```

- On the record path, core prefers `write`, then `writeBatch`, then converts once with `context.toEvent(record)` for `log`/`logBatch`. The conversion is memoized per record, so several transports share one projection and one id.
- On the event path (after processors), core prefers `log`/`logBatch` and derives a record only for record-only transports.
- `minLevel` filters per transport; processor routes (`routeProcessor`, `withLogEventRoute`) pin events to named transports.
- Sync throws and rejected promises are reported to logger meta; one failing transport never blocks the others.
- `ready()` is opt-in. Normal log calls never wait for transport startup.
- `close()` owns its own best-effort flush. Core calls `close()` when it exists and falls back to `flush()` only for transports without `close()`.

Transports own queueing and backpressure, batching, retry and circuit breaking, codec selection, destination delivery, drop and error counters, and flush and close semantics.

### Batching

`batchTransport(inner, options)` is the shared reliability layer used by the HTTP and OTLP transports and recommended around raw vendor transports. It provides:

- `maxRecords` (default 50), `maxBytes`, and `maxWaitMs` (default 1000 ms) flush triggers
- `maxQueueSize` with `drop-oldest`, `drop-newest`, or `throw` drop policies
- `concurrency` for parallel in-flight batches
- retries with exponential backoff and jitter
- a circuit breaker with half-open recovery
- `transport.dropped.<reason>` counters and an optional `onDrop` hook
- byte estimation only when `maxBytes` is finite, and no idle timer when the queue is empty

`retryTransport()` and `fallbackTransport()` cover transports that already batch or need a local backup sink. [Transports](TRANSPORTS.md) documents the delivery posture of every built-in transport.

### Console

The console transport does not serialize in pretty mode. It passes raw message, data, and error references to the original console methods so browser DevTools keep object inspection. It writes through the unpatched console registry, so it can run beside console capture without feedback loops, and it filters out records captured from the console by default.

### HTTP

- **Browser:** `fetch` with `keepalive`, `sendBeacon` on `pagehide`/hidden visibility, optional memory or IndexedDB offline queues, and event-count and Beacon byte limits (`maxBatchSize`, `beaconMaxBytes`).
- **Node:** `fetch` wrapped in `batchTransport`, with retry and circuit breaker options. Remote HTTP is not a synchronous crash-flush path.

Privacy defaults: fetch/XHR integrations capture no request or response bodies and no headers unless allowlisted, and the browser offline queue is off unless you pass one.

### File and Stdout

Node stdout, stderr, and file transports write NDJSON through a shared destination that tracks write callbacks and `drain`, supports optional `minLength` buffering, treats `EPIPE` as a clean shutdown, and implements `flushSync()` with synchronous writes for fatal paths. `fileTransport({ sync: true })` makes every write synchronous.

### Worker

`workerTransport()` moves I/O off the main thread by encoding batches with a codec and posting them to a worker, optionally transferring buffers:

```txt
main thread batch -> codec.encode(batch) -> Uint8Array -> postMessage(buffer, [buffer])
```

An optional ready and ack protocol makes worker acceptance observable; when the worker fails, pending batches go to a fallback transport or are counted as drops. `flushSync()` cannot cross the worker boundary.

### OTLP and Sentry

OTLP/HTTP JSON is a first-party transport because LoggerJS integrates with existing observability backends instead of defining its own protocol. Sentry support is an adapter package that maps records to Sentry structured logs and can capture error records as Sentry events using the SDK the application already initialized.

## Codecs

```ts
interface Codec<TPayload = string | Uint8Array> {
  name: string;
  contentType: string;
  encode(input: LogEvent | LogRecord | readonly (LogEvent | LogRecord)[], context?: EncodeContext): TPayload;
  decode?(payload: TPayload): LogEvent | LogEvent[];
  prepareRecordEncoder?(hints: RecordEncoderHints): PreparedRecordEncoder<TPayload>;
}
```

- `ndjsonCodec()` and `fastEventJsonCodec()` use native `JSON.stringify` semantics on a fast path and re-encode with the safe stringifier only when native serialization throws (circular references, BigInt), counting `codec.fallback`.
- `safeJsonCodec()` normalizes every item.
- `msgpackrCodec()` produces binary batches through `msgpackr`; `projectorCodec()` adapts custom wire schemas; `pinoCompatCodec()` emits Pino-shaped NDJSON; `otlpJsonCodec()` emits OTLP JSON.
- `EncodeContext` carries level-name lookup and `WeakMap` caches, so a codec can cache encoded fragments for immutable bound contexts and tags.
- `createPreparedRecordEncoder(codec)` lets a record-aware transport reuse codec-owned logger and tag fragments without moving serialization into the logger.

See [Codecs](CODECS.md) for the full contract.

## Integrations

```ts
interface Integration {
  name: string;
  setup(api: IntegrationSetupContext): void | Teardown;
}

interface IntegrationAPI {
  capture(input: CaptureInput): void;
  getLogger(category: LoggerCategory): LoggerLike;
  readonly unpatched: UnpatchedRegistry;
  guard<T extends (...args: never[]) => unknown>(fn: T): T;
}
```

`IntegrationSetupContext` combines this API with the logger methods (`info`, `error`, `flush`, and so on).

Loop prevention has three layers:

1. Original `console`, `fetch`, and `XMLHttpRequest` functions are registered before patching, and transports call them through the unpatched registry.
2. `api.guard()` drops re-entrant capture synchronously and counts `integration.dropped.reentrant`.
3. Captured records keep `source: "integration:<name>"`, so transports can filter self-generated records.

Integrations are set up once per instance and torn down in reverse order on `close()`. Node crash handling stays honest: with `exitOnUncaught`, `captureProcessIntegration()` captures a fatal record, calls `flushSync()` on sync-capable transports, waits a bounded time for async `flush()`, and then exits instead of leaving a zombie process.

## Routing

Routing uses category, level, source, and explicit transport selection:

- category prefix routes in the registry
- per-transport `minLevel`
- source exclusions, such as the console transport skipping `integration:console` records
- processor-attached routes that pin events to named transports

The record fast path performs no route filtering: routes can only be attached by processors, and the record path only runs for loggers without processors.

## Reliability

Default delivery is **best-effort at-most-once**. LoggerJS does not block application progress indefinitely to guarantee delivery. Every loss path is observable through logger meta counters (`getLoggerMetaStats()`, `getLoggerSelfMetrics()`) and transport stats:

- queue overflow
- batch too large
- retry exhausted
- circuit breaker open
- Beacon rejected
- offline queue quota exceeded
- flush deadline exceeded
- integration re-entrancy drop
- middleware, processor, codec, or transport exception

## Privacy and Security

- `redactProcessor()` masks common sensitive keys by default: `password`, `passwd`, `secret`, `token`, `authorization`, `cookie`, `set-cookie`, `apiKey`, and `api_key`.
- fetch and XHR integrations capture no bodies and no headers unless allowlisted.
- Browser offline persistence is off unless an offline queue or IndexedDB transport is configured.
- No `eval` or generated code, and no runtime dependencies in core.

Any feature that writes logs to durable browser storage is explicit, because it changes the application's privacy posture. See [Operations](OPERATIONS.md) and [SECURITY.md](https://github.com/jskits/loggerjs/blob/main/SECURITY.md).

## Performance

### Budget

| Path | Target | Current |
| --- | --- | --- |
| Disabled level call | one numeric comparison, zero allocation | ~3 ns on the reference machine |
| Record allocation | one record object; no data copy unless middleware clones | met |
| Node lean NDJSON path | same class as pino for equivalent output | ~1.19x pino throughput on the M1 Max reference, slower than pino on the M4 Pro row |
| Core size | as small as the platform-neutral feature set allows | ~21 KB gzip for the full barrel with its shared chunks; after tree-shaking and minification about 6.3 KB gzip for `createLogger` plus `consoleTransport`, 8.1 KB with `browserHttpTransport`, and 7 KB with `stdoutTransport` |

`pnpm size:check` enforces raw and gzip budgets for every package entry and for those three minimal application bundles, and `pnpm bench:gate` enforces paired A/B ratios against pino for the disabled, enqueue, lean, prepared, and full-envelope paths. Benchmarks run on Node and in a real browser; see [Benchmarks](BENCHMARKS.md) and the [benchmark matrix](BENCHMARK-MATRIX.md).

### Decision: keep the record pipeline; optimize through codec-owned preparation

LoggerJS allocates one `LogRecord` per log so middleware, processors, integrations, and multiple transports can observe one shared value, and the codec keeps a never-throw fallback contract. With that architecture the lean Node NDJSON path is in pino's class: on the M1 Max reference machine the paired A/B harness measures lean at ~1.19x pino throughput and the codec-owned prepared path at ~1.28x, while the full envelope (which adds `id`, `seq`, and `levelName`) is ~0.93x. The ranking is CPU and Node/V8 dependent; on the M4 Pro row pino is faster.

The hot path gets there without moving serialization into the logger:

- `getContext()` returns early when no context providers are registered, instead of merging empty providers on every call.
- `fastEventJsonCodec` resolves its `include*` options once at creation and emits the header in a single template.
- Prepared record encoders let transports reuse logger, category, and tag fragments that the codec owns.

A fusion fast path that bypasses the record whenever a logger has one sync transport and no middleware is rejected as the default, because it would:

- create a performance cliff where adding the first middleware silently costs a large share of throughput,
- move serialization into the logger, breaking the codec-belongs-to-transport boundary,
- and double the hot-path surface that every semantic change must keep in sync, which is exactly where id-drift and source round-trip defects come from.

Performance work goes to the default paths (batch enqueue, default codecs, prepared codec contracts) and to regression gating. Revisit the fusion path only if a production use case shows that a separate semantic hot path matters.

## Testing Strategy

- Unit tests for record construction, the level gate, overloads, child context, middleware, routing, and transport errors
- Codec tests for safe JSON fallbacks and round trips
- Loop-prevention tests with console transport and console capture enabled together
- Playwright tests in Chromium, Firefox, and WebKit for pagehide/Beacon flushing, fetch/XHR capture, global errors, and offline queues
- Node child-process tests for uncaught-exception flush and exit behavior
- Runtime smoke tests for packed packages on Node, Bun, Deno, and workerd/Miniflare
- Size budgets for every package entry and paired benchmark regression gates
- Live tests against Elasticsearch, Loki, Datadog, and CloudWatch

Every change to a layer ships with tests, and hot-path changes ship with a benchmark or size measurement. See [Contributing](CONTRIBUTING.md) and the [test inventory](TEST-INVENTORY.md).
