# LoggerJS Architecture

> Status: target architecture for the v1 implementation plan.
> Source inputs: `DESIGN.md`, `log.md`, and the current monorepo skeleton.

LoggerJS is an isomorphic structured logger for browser, Node, Bun, Deno, and edge runtimes. The product architecture is built around three user-facing concepts:

- **Integration**: opt-in automatic collection, such as browser console capture, global script errors, HTTP errors, page lifecycle flush, Node process errors, and runtime diagnostics.
- **Middleware**: synchronous record transforms and filters, such as redaction, sampling, tag/type enrichment, request correlation, dedupe, and route-specific policies.
- **Transport**: the destination boundary, such as console, stdout, file, HTTP batch, OTLP, Sentry, DB, worker-hosted delivery, or any user custom sink.

There is one additional technical boundary that must stay first-class: **Codec**. A codec belongs to a transport and owns serialization/deserialization. Middleware must not serialize records. Console transport should preserve raw values. HTTP/file/OTLP transports choose the codec they need.

## Current Repository Baseline

The current repo already has a useful v0 skeleton:

```txt
packages/core        Logger, LogEvent, levels, codecs, console/memory/batch transports
packages/browser     Browser HTTP transport and console/error/fetch/XHR/page lifecycle integrations
packages/node        stdout/file/http transports and process integration
packages/processors  redact/sample/tags/type/dedupe/trace processors
packages/codecs      fixed-shape JSON, msgpackr adapter, projector codec
packages/otel        OTLP JSON mapping and HTTP transport
examples/*           browser and node basic demos
```

The target architecture intentionally moves beyond that skeleton:

- `Processor` becomes `Middleware` in the public mental model. A compatibility alias can remain while the API stabilizes.
- `LogEvent` becomes a lower-level `LogRecord` with a single hidden class, lazy message support, an error slot, bound context, and source metadata.
- Coarse browser/node packages can remain as presets, but stable v1 packages should split platform transports and integrations into smaller installable units.
- The current dual ESM/CJS output should move to ESM-only with conditional exports once the public API is ready.
- The current batch transport is a simple buffer. The target needs bounded queues, byte limits, retry, drop counters, circuit breaking, pagehide/beacon behavior, and flush semantics per runtime.

## Non-Negotiable Design Rules

1. **Core is platform-neutral.** `@loggerjs/core` must not import browser, Node, Bun, Deno, worker, filesystem, fetch, or diagnostics APIs.
2. **Disabled logging is almost free.** A disabled level call must do one numeric level comparison and return before record allocation, message stringification, context merge, or integration work.
3. **Serialization happens only at the transport boundary.** The pipeline keeps raw references. `resolveMessage(record)` is the only allowed middleware-triggered lazy evaluation.
4. **Middleware is synchronous.** No promises, no Koa-style `next`, and no async lookup in the hot path.
5. **Integrations use the same pipeline as manual logs.** Automatic records differ only by `source`; they still pass through middleware, routing, batching, codec, and transport policy.
6. **Integrations are explicit and reversible.** Any monkey patch must be opt-in, idempotent, guarded against reentry, and fully torn down.
7. **Logger errors never escape to application code.** Internal failures are counted and reported through a rate-limited meta logger.
8. **No object pool in v1.** Short-lived records should stay young-generation GC objects unless benchmarks prove otherwise.

## End-To-End Pipeline

```txt
manual API / integration capture
        |
        v
  level gate
        |
        v
  create LogRecord
        |
        v
  global middleware
        |
        v
  transport router / fan-out
        |
        +--> per-transport middleware
        |          |
        |          v
        |     transport buffer
        |          |
        |          v
        |     codec.encode(batch)
        |          |
        |          v
        |     sink: console / stdout / file / HTTP / OTLP / worker / custom
        |
        +--> ...
```

The record must never be stringified before the chosen transport is ready to ship. This is what lets console preserve interactive objects, HTTP choose JSON or binary, file choose NDJSON, and OTLP choose its wire mapping without penalizing other destinations.

## Core Record Model

The target internal record is `LogRecord`, not the current `LogEvent` envelope. It is optimized for a stable hidden class and transport-owned projection:

```ts
export interface LogRecord {
  time: number;
  level: number;
  category: readonly string[];
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

Implementation rules:

- Construct records through a single `createRecord()` path.
- Assign every field in the same order, including `null` fields.
- Do not `delete` fields or attach ad hoc properties to the record.
- Extra data belongs in `props` or immutable `ctx`.
- `time` is `Date.now()`; ordering within equal timestamps is `seq`.
- `err` stays separate from `props` because error encoding, stack truncation, cause handling, and dedupe are specialized.

The current `LogEvent` shape can remain temporarily as a codec projection or compatibility type, but it should not drive the hot path once the v1 rewrite starts.

## Logger API

LoggerJS supports two acquisition models:

```ts
const log = createLogger({
  category: "app",
  level: "info",
  transports: [consoleTransport()]
});
```

```ts
const log = getLogger(["library", "parser"]);

await configure({
  middleware: [redact({ paths: ["password", "*.token"] })],
  transports: {
    console: consoleTransport(),
    http: httpTransport({ url: "/v1/logs", codec: jsonCodec() })
  },
  loggers: [
    { category: ["app"], level: "debug", transports: ["console", "http"] },
    { category: ["library"], level: "warn", transports: ["http"] }
  ],
  integrations: [consoleIntegration(), globalErrorsIntegration()]
});
```

Required call forms:

```ts
log.info("user logged in", { userId: 42 });
log.error(err, "save failed", { orderId });
log.debug(() => expensiveDebugMessage());
log.event(CheckoutCompleted, { orderId, amountCents });
log.child({ requestId }).warn("retrying");
await log.flush();
```

The overload rule stays small:

- first arg `string`: message
- first arg `function`: lazy message
- otherwise: error slot, with optional message and props

No printf-style formatting belongs in core. Structured fields are first-class; formatting is a display concern.

## Registry And Configuration

`getLogger(category)` exists for library authors. Before configuration, it returns a void logger. After `configure()`, it routes through the configured pipeline.

Configuration requirements:

- prefix matching by category, where `["app"]` applies to `["app", "checkout"]`
- named transports and named middleware
- explicit integration lifecycle management
- optional early ring buffer for pre-config logs
- `configure({ reset: true })` to replace old transports and call async disposal hooks
- immutable runtime snapshots so hot path reads do not traverse mutable config structures

This registry is a strategic feature: it lets third-party libraries log without coupling to any backend or forcing application configuration.

## Context

There are two context modes:

- **Explicit context** via `logger.child(bindings)`. Child bindings are flattened and frozen at child creation time.
- **Implicit context** via `withContext(bindings, fn)`. Node/Bun/Deno use AsyncLocalStorage or equivalent conditional exports. Browser initially degrades to synchronous-scope context until TC39 AsyncContext is viable.

Codec-level context optimization replaces pino-style global chindings:

```ts
interface EncodeContext {
  levelName(level: number): string;
  ctxCache: WeakMap<object, unknown>;
  schemaCache: WeakMap<object, unknown>;
}
```

Each codec may cache encoded fragments for immutable bound contexts. This preserves the performance benefit without making JSON serialization a global logger concern.

## Middleware

Target interface:

```ts
export interface Middleware {
  readonly name: string;
  process(record: LogRecord): LogRecord | null;
}
```

Execution model:

- global middleware runs once before fan-out and may mutate the single record in place
- per-transport middleware runs after fan-out and must treat the record as shared
- per-transport changes use `cloneRecord(record, patch)` to preserve shape and avoid cross-transport leakage
- returning `null` drops the record
- middleware exceptions are caught, counted, and do not stop the remaining pipeline unless the middleware explicitly drops

Built-ins should cover:

- `redact`: compiled path/key redaction with copy-on-write on matched branches
- `sample`: level/category/key-based sampling, with error and fatal defaulting to full retention
- `rateLimit`: token bucket by category/level/source
- `dedupe`: fingerprinted burst collapse
- `fingersCrossed`: low-level ring buffer released by an error trigger
- `enrich`: synchronous props/context enrichment
- `tags` and `type`: thin compatibility helpers for current processor behavior
- `traceContext`: OTel or user-provided trace/span injection

Middleware must not call `JSON.stringify`, `String(record.props)`, or recursively normalize whole records. If it needs a message, it must call `resolveMessage(record)` intentionally.

## Transports

Target interface:

```ts
export interface Transport {
  readonly name: string;
  write(record: LogRecord): void;
  flush(): Promise<void>;
  flushSync?(): void;
  dispose(): Promise<void>;
  filter?(record: LogRecord): boolean;
  middleware?: Middleware[];
}
```

Transport responsibilities:

- final routing filters
- queue and backpressure policy
- batching
- retry and circuit breaking
- codec selection and serialization
- destination-specific delivery
- drop/error counters
- flush and disposal semantics

### Batching Base

The shared batching implementation should support:

- `maxRecords`
- `maxBytes`
- `maxWaitMs`
- `concurrency`
- retry with exponential backoff and full jitter
- `drop-old` and `drop-new`
- drop counters and hooks
- circuit breaker with half-open recovery
- no idle timer when the queue is empty
- encoded-size accounting at ship time

The current `batchTransport()` is acceptable as a bootstrap utility, but it is not the v1 reliability layer.

### Console Transport

Console transport should not serialize in pretty mode. It should pass raw `msg`, `props`, and `err` references to the original console methods so browser devtools keep object inspection.

It must use the unpatched console registry so it can coexist with console capture without feedback loops.

### HTTP Transport

HTTP transport is a shared abstraction with platform implementations:

- Browser: `fetch`, `keepalive`, `sendBeacon` on `pagehide`/`visibilitychange`, optional IndexedDB offline queue, and strict payload limits around the 64 KiB beacon budget.
- Node: global `fetch`/undici, retry/circuit breaker, and no claim of sync crash flush.
- Edge: `waitUntil` hook for response-lifetime-safe delivery.

Privacy defaults:

- no request/response body collection
- no headers unless allowlisted
- no offline disk persistence unless explicitly enabled

### File And Stdout Transports

Node stdout/stderr/file transports should default to NDJSON. File transport needs a real `flushSync()` path using `fs.writeSync` or an equivalent crash-safe primitive. Async stream writes alone are not enough for fatal process events.

### Worker Transport

Node worker transport should move IO and retry state off the main thread. The preferred path is:

```txt
main thread batch -> codec.encode(batch) -> Uint8Array -> postMessage(buffer, [buffer])
```

If the worker fails, transport should degrade to inline mode and emit a meta warning. `flushSync` remains unavailable across worker boundaries.

### OTLP And Sentry

OTLP/HTTP JSON is a first-party transport because LoggerJS should integrate with existing observability backends rather than invent a logging backend protocol.

Sentry support should be an adapter package. LoggerJS maps records to Sentry structured logs and optionally captures error records as Sentry events.

## Codecs

Target interface:

```ts
export interface Codec<Out extends string | Uint8Array = string | Uint8Array> {
  readonly name: string;
  readonly contentType: string;
  encode(batch: readonly LogRecord[], ctx: EncodeContext): Out;
  decode?(data: Out): unknown[];
}
```

Required codecs:

- `jsonCodec`: default NDJSON/log JSON codec with fixed-field ordering, native `JSON.stringify` for ordinary props, and safe fallback only for failing branches.
- `structuredCodec`: rich value preserving codec with symmetric decode for Error, cause chains, AggregateError, circular/shared references, BigInt, Date, RegExp, URL, Map, Set, TypedArray, ArrayBuffer, `undefined`, `NaN`, infinities, and `-0`.
- `msgpackCodec`: binary batch codec, either a benchmark-proven custom subset or a small adapter over `msgpackr`.
- `projectorCodec`: utility adapter for custom wire schemas.

The structured codec should use a flat value-pool format, not `eval`, `new Function`, or recursive revivers. Decode should be `JSON.parse` plus a deterministic pointer restoration pass, making it CSP-friendly and suitable for browser replay tools.

## Integrations

Target interface:

```ts
export interface Integration {
  readonly name: string;
  setup(api: IntegrationAPI): Teardown;
}

export interface IntegrationAPI {
  capture(input: CaptureInput): void;
  getLogger(category: string | readonly string[]): Logger;
  unpatched: UnpatchedRegistry;
  guard<T extends (...args: any[]) => any>(fn: T): T;
}
```

Loop prevention has three layers:

1. Register original console/fetch/XHR functions before patching.
2. Guard synchronous logger execution so reentrant capture is dropped and counted.
3. Preserve `record.source` and let transports filter self-generated records.

Required browser integrations:

- console capture for `log`, `info`, `warn`, `error`, `debug`, and `trace`
- global script/resource errors
- `unhandledrejection`
- optional `securitypolicyviolation`
- fetch and XHR HTTP error collection
- page lifecycle flush hooks
- optional offline replay hooks

Required Node integrations:

- `uncaughtException`
- `unhandledRejection`
- `warning`
- `beforeExit`/`exit` flush handling
- diagnostics_channel subscriptions for undici and Node HTTP where available

Node crash behavior must be honest. If `exitOnUncaught` is enabled, fatal capture should flush sync-capable transports, attempt bounded async flush for the rest, and then preserve process exit semantics. The integration must not silently turn fatal crashes into zombie processes.

## Routing

Routing uses category, level, source, tags/type, and explicit transport filters.

Configuration should support:

- category prefix rules
- per-transport minimum levels
- source exclusions such as excluding `integration:console` from console transport
- per-transport middleware
- named routes that can be reused in presets

Routing must be resolved into immutable runtime snapshots so each log call does not perform expensive dynamic config lookup.

## Performance Budget

Initial internal budget:

| Path | Target |
| --- | --- |
| Disabled level call | one numeric comparison, zero allocation |
| Enabled record to queue, 3 middleware, no stack | <= 1 microsecond per record on mainstream desktop CPU |
| JSON/NDJSON codec | million-records-per-second class for ordinary objects |
| Node NDJSON full path | at least 80% of pino for equivalent output before v1 |
| Core size | <= 4 KB min+gzip |
| Record allocation | one record object; no data copy unless middleware explicitly clones |

Benchmarking must cover Node and real browsers, not only synthetic Node loops. The suite should compare pino, winston, LogTape, native console, native `JSON.stringify`, current LoggerJS, and target LoggerJS paths.

## Reliability

Default semantics are **best-effort at-most-once**. LoggerJS must not block application progress indefinitely to guarantee log delivery.

Every loss path must be observable:

- queue overflow
- batch too large
- retry exhausted
- circuit breaker open
- beacon failed
- offline queue quota exceeded
- flush deadline exceeded
- integration loop guard drop
- middleware/transport exception

These counters should be available through the meta logger and optional stats APIs.

## Privacy And Security

Defaults:

- redact common sensitive keys: authorization, cookie, set-cookie, password, passwd, token, secret, apiKey, api_key, and `*_key`
- fetch/XHR integrations do not capture bodies
- fetch/XHR integrations do not capture headers unless allowlisted
- browser offline queue is disabled by default
- no `eval` or generated code in default builds
- no runtime dependencies in core

Any feature that writes logs to durable browser storage must be explicit because it changes the application's privacy posture.

## Testing Strategy

Required test layers:

- unit tests for core record construction, level gate, overloads, child context, middleware, router, and transport errors
- codec property tests for safe JSON and structured round-trip behavior
- loop prevention tests with console transport and console integration enabled together
- browser Playwright tests for pagehide/beacon flush, fetch/XHR capture, global errors, and offline queue behavior
- Node child-process tests for uncaught exception flush and exit semantics
- runtime smoke tests for Node, Bun, Deno, and workerd/miniflare
- size-limit checks for core and integration packages
- benchmark regression checks with explicit thresholds

No milestone is complete without examples, tests, and at least one benchmark or size measurement relevant to the changed layer.

## Package Direction

The v0 package layout can support development, but the v1 public layout should move toward:

```txt
@loggerjs/core
@loggerjs/transport-http
@loggerjs/transport-otlp
@loggerjs/transport-file
@loggerjs/transport-worker
@loggerjs/codec-structured
@loggerjs/codec-msgpack
@loggerjs/integration-console
@loggerjs/integration-global-errors
@loggerjs/integration-fetch
@loggerjs/integration-node
@loggerjs/otel
@loggerjs/sentry
@loggerjs/pretty
@loggerjs/browser    preset/meta package
@loggerjs/node       preset/meta package
```

Preset packages are allowed, but ownership of platform APIs should live in small packages so users can install only the collection and transport surface they need.

## Completion Criteria For v1

LoggerJS reaches v1 readiness when:

- core public API is locked by API report
- disabled hot path and enabled queue path meet budget on Node and browser
- codec JSON, structured, and msgpack paths have benchmark data
- browser and Node integrations have loop and teardown tests
- OTLP collector demo works end to end
- crash flush behavior is tested by child process
- privacy defaults are documented and tested
- examples cover browser, Node service, edge worker, and OTLP collector
- migration guide exists for console.log, pino, winston, and LogTape-style library logging
