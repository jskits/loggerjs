# LoggerJS Compared With Other JavaScript Loggers

This page compares the current LoggerJS workspace with common JavaScript logging
libraries. It is written from the current repository state, not from a target
roadmap.

## Scope

The comparison uses first-party behavior unless a cell explicitly says
"ecosystem". Sources were checked on 2026-06-12:

- LoggerJS repository docs: [README](../README.md), [Concepts](CONCEPTS.md),
  [Transports](TRANSPORTS.md), [Integrations](INTEGRATIONS.md),
  [Processors](PROCESSORS.md), [Codecs](CODECS.md), [Benchmarks](BENCHMARKS.md).
- Pino official docs: <https://getpino.io/>,
  <https://github.com/pinojs/pino/blob/main/docs/api.md>,
  <https://github.com/pinojs/pino/blob/main/docs/transports.md>,
  <https://github.com/pinojs/pino/blob/main/docs/browser.md>,
  <https://github.com/pinojs/pino/blob/main/docs/redaction.md>.
- Winston official README: <https://github.com/winstonjs/winston>.
- LogTape official docs and JSR package page: <https://logtape.org/>,
  <https://logtape.org/manual/categories>, <https://logtape.org/manual/sinks>,
  <https://logtape.org/manual/contexts>, <https://jsr.io/@logtape/logtape>.
- Bunyan official README: <https://github.com/trentm/node-bunyan>.
- Lightweight and developer-experience tools:
  <https://github.com/pimterry/loglevel>, <https://github.com/debug-js/debug>,
  <https://github.com/unjs/consola>, <https://tslog.js.org/>.

The benchmark numbers below are only for the scenarios in
[BENCHMARKS.md](BENCHMARKS.md). They do not claim universal superiority across
all sinks, runtimes, payload shapes, or third-party transports.

## Short Answer

LoggerJS is best when the logging problem spans browser and server collection:
automatic integrations, structured middleware, reliable transport delivery,
offline browser persistence, codec choice per destination, and vendor/DB/OTLP
delivery from one mental model.

Pino is still the mature default when the main requirement is a minimal,
Node-first JSON logger with a large ecosystem. On the current M1 Max reference
benchmark, LoggerJS's equivalent lean/prepared paths are faster, but the ranking
is CPU/Node-V8 dependent. Winston is still the mature, flexible Node transport
and format ecosystem. LogTape is the closest architectural peer for
library-first usage and multi-runtime categories. Bunyan is a stable legacy JSON
logger for Node services.

## At A Glance

Legend: ✅ first-party fit, 🧩 ecosystem fit, ⚠️ partial or depends on the chosen
configuration, ❌ no checked first-party equivalent, 📊 measured in this repo.

| Capability                      | LoggerJS                       | Pino                           | Winston                  | LogTape               | Bunyan                |
| ------------------------------- | ------------------------------ | ------------------------------ | ------------------------ | --------------------- | --------------------- |
| Node server logging             | ✅ first-party                 | ✅ first-party                 | ✅ first-party           | ✅ first-party        | ✅ first-party        |
| Browser runtime                 | ✅ first-party                 | ⚠️ browser API                 | ⚠️ not primary           | ✅ first-party        | ⚠️ bundler support    |
| Library-safe default            | ✅ silent until configured     | ⚠️ app-oriented                | ⚠️ app-oriented          | ✅ core design        | ⚠️ app-oriented       |
| Automatic browser capture       | ✅ 19 first-party integrations | ❌ none checked                | ❌ none checked          | ❌ none checked       | ❌ none checked       |
| Automatic Node collection       | ✅ 16 first-party integrations | 🧩 ecosystem                   | ⚠️ exceptions/rejections | ✅ framework packages | ⚠️ stream/custom      |
| Multi-destination delivery      | ✅ transports                  | ✅ transports                  | ✅ transports            | ✅ sinks              | ✅ streams            |
| Built-in batching/retry/offline | ✅ shared primitives           | ⚠️ transport-dependent         | ⚠️ transport-dependent   | ⚠️ sink-dependent     | ⚠️ stream-dependent   |
| Transport-owned codecs          | ✅ explicit boundary           | ⚠️ logger/transport formatting | ⚠️ format pipeline       | ⚠️ sink formatting    | ⚠️ serializers        |
| Privacy/redaction               | ✅ processors + sanitizers     | ✅ built-in redaction          | ⚠️ custom formats        | ✅ redaction package  | ⚠️ serializers/custom |
| Direct Node JSON path           | ✅ 1.19× pino                  | 📊 baseline                    | ❌ slower measured       | ❌ slower measured    | Not measured here     |

## Detailed Matrix

| Axis                         | LoggerJS                                                                                                                                                                                                                                                                                           | Pino                                                                                                           | Winston                                                                                                           | LogTape                                                                                                                | Bunyan                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Primary fit                  | Isomorphic structured logging with automatic collection and reliable delivery                                                                                                                                                                                                                      | Low-overhead Node JSON logging                                                                                 | Flexible Node logger with mature format/transport model                                                           | Library-first structured logging across JS runtimes                                                                    | Simple JSON logging for Node services                                |
| Runtime posture              | `@loggerjs/core` is platform-neutral; first-party Node and browser packages are split by runtime                                                                                                                                                                                                   | Node-first with a documented browser API                                                                       | Node-first; browser use is not the primary documented path                                                        | First-party support for Node, Deno, Bun, browsers, Cloudflare Workers, and edge                                        | Node services; docs mention Browserify/Webpack/NW.js support         |
| Library-safe default         | Yes: `getLogger()` is silent until the host configures logging                                                                                                                                                                                                                                     | Partial: libraries can accept/inject a logger, but Pino itself is app-oriented                                 | Partial: libraries can accept/inject a logger, but Winston itself is app-oriented                                 | Yes: a core design goal                                                                                                | Partial: child loggers help, but app-level configuration is expected |
| Structured data              | Yes: records/events preserve message, data, context, tags, trace, source, type                                                                                                                                                                                                                     | Yes: JSON logs by default                                                                                      | Yes: mutable `info` objects plus formats                                                                          | Yes: structured log records/properties                                                                                 | Yes: JSON records                                                    |
| Levels                       | Pino-compatible numeric levels plus names                                                                                                                                                                                                                                                          | Built-in numeric levels and custom levels                                                                      | RFC5424-style levels plus custom levels                                                                           | Severity levels with category configuration                                                                            | Numeric levels                                                       |
| Category/logger model        | Category arrays, child loggers, registry configuration                                                                                                                                                                                                                                             | Child loggers and bindings                                                                                     | Logger instances, child loggers, containers                                                                       | Hierarchical categories with sink inheritance                                                                          | Logger name plus child loggers; docs say names are not hierarchical  |
| Middleware/filter layer      | First-party middleware and processors for enrich, redact, sample, dedupe, route, rate-limit, fingerprint, normalize                                                                                                                                                                                | Hooks, serializers, mixins, redaction; broader middleware is usually app/ecosystem code                        | Format chains and custom formats; mutable object pipeline                                                         | Filters, contexts, formatters, redaction package                                                                       | Serializers and custom streams                                       |
| Serialization ownership      | Codec belongs to each transport; built-ins include JSON, safe JSON, NDJSON, fast-event-json, msgpackr, OTLP JSON                                                                                                                                                                                   | Core JSON serialization with serializers/formatters and transport output                                       | Format chain finalizes output per logger/transport                                                                | Sinks and formatters own output                                                                                        | JSON records plus serializers                                        |
| Transport/sink model         | First-party console, pretty DevTools/terminal output, memory, test, batch, stdout/stderr, file, rotating file, HTTP, syslog, worker, browser HTTP, IndexedDB, WebSocket, service worker, BroadcastChannel, OTLP, Sentry, Datadog, Elasticsearch, Loki, CloudWatch, SQLite/Postgres/custom DB       | Destination/transport API, multi-target transports, `pino/file`, `pino-pretty`, and ecosystem transports       | Built-in console/file/http/stream-style transports and broad custom transport ecosystem                           | Sinks with console/stream in core and packages for file, OTEL, Sentry, syslog, CloudWatch, Windows Event Log, and more | Streams for stdout/file/rotation/raw/custom                          |
| Automatic browser collection | 19 first-party browser/frontend integrations: console, script/resource errors, unhandled rejection, fetch, XHR, Web Vitals, performance entries, user actions, router adapters, ReportingObserver, service worker, WebSocket, framework error hooks, runtime host, and browser context propagation | Browser API exists for direct logging; no checked first-party equivalent to the LoggerJS browser capture suite | No checked first-party equivalent to the LoggerJS browser capture suite                                           | Browser runtime support; checked docs do not show an equivalent browser capture/offline suite                          | No checked first-party equivalent                                    |
| Automatic Node collection    | 16 first-party Node.js/server integrations: process, diagnostics_channel, Express, Fastify, Koa, Hapi, Nest middleware, fetch, http client, CLI, serverless, queue, BullMQ, Prisma, Redis, and generic DB clients                                                                                  | Ecosystem integrations such as Fastify/Pino and pino-http are common; core docs cover logger/transports        | Built-in uncaught exception and unhandled rejection handling; framework request logging is usually ecosystem code | First-party framework integration packages include Express, Fastify, Hono, Koa, and Drizzle                            | No broad first-party instrumentation suite in checked docs           |
| Browser persistence/export   | First-party IndexedDB transport, IndexedDB HTTP offline queue, pagehide flush, ZIP export                                                                                                                                                                                                          | No checked first-party equivalent                                                                              | No checked first-party equivalent                                                                                 | No checked first-party equivalent in the checked core docs                                                             | No checked first-party equivalent                                    |
| Delivery reliability         | Shared batching, retry/backoff, byte limits, circuit breaker, flush/flushSync/close, offline queues where applicable                                                                                                                                                                               | High-throughput stream/transport model; transport startup caveats documented                                   | Transport model with exceptions/rejections, querying, streaming, and close/await guidance                         | Sink model with category/filter/context control; reliability depends on chosen sink packages                           | Stream model; reliability depends on chosen streams                  |
| Privacy controls             | Redaction, privacy guard, normalize-error, safe codecs, URL/header sanitizers in integrations                                                                                                                                                                                                      | Built-in path redaction using fast-redact                                                                      | Formatting and custom transforms; no built-in redaction claim in checked README                                   | Redaction package and filters                                                                                          | Serializers/custom streams                                           |
| Context propagation          | Child loggers, bindings, tags, `withContext()`, Node AsyncLocalStorage installer                                                                                                                                                                                                                   | Child loggers, bindings, mixins; async context is app/ecosystem code                                           | Child logger metadata; async context is app/ecosystem code                                                        | Explicit and implicit contexts with configurable context local storage                                                 | Child loggers and serializers                                        |
| TypeScript posture           | First-party TypeScript source and declarations, typed events, subpath exports                                                                                                                                                                                                                      | Types included in the package ecosystem                                                                        | Types included in the package ecosystem                                                                           | TypeScript-first package                                                                                               | Historical Node package with TypeScript ecosystem support            |
| Dependency posture           | `@loggerjs/core` has no dependencies; full workspace packages add only targeted deps such as `msgpackr` in `@loggerjs/codecs`                                                                                                                                                                      | Small core with focused dependencies                                                                           | Mature but larger dependency graph                                                                                | Zero dependencies for `@logtape/logtape`                                                                               | Older package with optional deps for some features                   |

## Performance Snapshot

Current measured snapshot from [BENCHMARKS.md](BENCHMARKS.md) and the
checked-in [benchmark matrix](BENCHMARK-MATRIX.md) — reference machine Apple M1
Max (64 GB), Node v22.21.1, pino 10.3.1, winston 3.19.0, LogTape 2.1.3. The
loggerjs-vs-pino rows are the drift-canceling paired A/B (22 runs); competitor
rows are the sequential suite:

| Scenario                              | ns/op | Read                                                         |
| ------------------------------------- | ----: | ------------------------------------------------------------ |
| loggerjs disabled debug, lazy message |     3 | Disabled level path is at pino parity                        |
| pino disabled debug                   |     9 | Same class of overhead                                       |
| loggerjs prepared lean record sink    |   224 | Codec-owned prepared encoder — 1.28x pino (paired A/B)       |
| loggerjs lean record sink             |   242 | Lean JSON via `fastEventJsonCodec` — 1.19x pino (paired A/B) |
| pino NDJSON noop sink                 |   287 | Direct JSON path; baseline                                   |
| loggerjs full-envelope record sink    |   307 | Adds `id`, `seq`, and `levelName` (~0.9x pino)               |
| node console info noop stream         |   769 | ~3x slower than the loggerjs lean sink                       |
| winston JSON noop sink                | 2,726 | ~11x slower than the loggerjs lean sink                      |
| LogTape JSON lines noop sink          | 6,584 | ~27x slower than the loggerjs lean sink                      |

The honest interpretation:

- On the M1 Max reference machine LoggerJS lean and prepared are **faster than
  Pino** for equivalent output (1.19x / 1.28x, paired A/B, reproducible across
  22 runs). This is **not** a universal "beats Pino" claim: the ranking is
  CPU/Node-V8 dependent, and the docs treat the difference as an empirical
  benchmark result rather than a proven mechanism. Reproduce on your hardware
  with `BENCH_AB=1 pnpm bench:node` and use `pnpm bench:matrix` for durable
  cross-machine evidence.
- LoggerJS reaches Pino's class on equivalent output **without** giving up its
  record pipeline — that pipeline is a deliberate design, not accidental
  overhead.
- The record pipeline buys first-class middleware, integrations, multi-transport
  routing, codec selection, and browser/server symmetry.
- These numbers do not compare every possible Pino transport, Winston format
  chain, LogTape sink, or browser scenario.

## Where LoggerJS Is Stronger

### Browser and Isomorphic Applications

LoggerJS has first-party browser transports and integrations: console capture,
script/resource errors, fetch/XHR failures, Web Vitals, page lifecycle flushing,
router events, user actions, WebSocket lifecycle, service worker lifecycle,
ReportingObserver, IndexedDB persistence, offline HTTP queues, and ZIP export.

This is the biggest practical difference from Pino, Winston, and Bunyan. Those
libraries can be used in browsers to varying degrees, but the checked docs do
not show a first-party automatic browser collection and local persistence suite
equivalent to LoggerJS.

### Transport-Owned Codecs

LoggerJS keeps structured values raw until the transport boundary. Serialization
is a transport concern, so stdout can use NDJSON, browser HTTP can use safe JSON
or a lean fast codec, OTLP can use an OTLP shape, and a custom transport can use
MessagePack or a domain-specific projection.

This is different from the common logger-level formatter model. It makes
multi-destination logging less surprising because each destination owns its wire
contract.

### Built-In Reliability Primitives

LoggerJS ships common delivery controls as reusable pieces: batch transport,
retry/backoff, byte limits, circuit breaker behavior, flush/close lifecycle,
browser `sendBeacon`, IndexedDB offline queues, and transport stats where
applicable. The goal is that writing a remote transport means implementing the
destination, not rewriting the reliability layer.

### Automatic Collection as a First-Class Concept

LoggerJS integrations are explicit, reversible, and routed through the same
pipeline as manual logs. Captured logs still pass through middleware,
processors, routing, codecs, and transports. This matters for privacy because
redaction and sampling stay centralized.

## Where Another Logger May Be Better

### Choose Pino When Minimal Node JSON Logging Is The Main Requirement

Pino remains the reference point for low-overhead Node JSON logging and has a
mature ecosystem for Node web services. Current LoggerJS paired A/B numbers put
the lean/prepared equivalent-output paths ahead on the M1 Max reference machine,
but that ranking is CPU/Node-V8 dependent. If the application only needs
app-authored server logs to stdout or a Pino transport, Pino is still the
simpler and more battle-tested choice.

### Choose Winston When You Need Its Mature Transport/Format Ecosystem

Winston is broad, stable, and flexible. Its `format` chain and transport model
are familiar in many Node applications, and its README documents exception
handling, rejection handling, profiling, querying, streaming, custom formats,
and custom transports. Existing Winston deployments should migrate only when
LoggerJS's isomorphic collection, middleware model, or measured performance
benefit matters enough to justify the change.

### Choose LogTape For Multi-Runtime Library-First Logging

LogTape is the closest conceptual peer to LoggerJS for library authors. Its
official package page emphasizes zero dependencies, library-first design,
structured logging, hierarchical categories, runtime diversity, redaction, and
framework integration packages. If Deno/Bun/edge parity and zero dependencies in
the core package are the top priority, LogTape is a strong fit.

Choose LoggerJS over LogTape when first-party browser telemetry capture,
IndexedDB/offline workflows, Node process/client/server integrations,
transport-owned codecs, and current pino-relative Node benchmarks are more
important.

### Choose Bunyan For Legacy Node JSON Compatibility

Bunyan remains relevant when an existing service already emits Bunyan-shaped
JSON or relies on the Bunyan CLI/stream ecosystem. For new browser/server
applications, LoggerJS covers a much wider built-in surface.

## Other Common Tools

| Tool             | Best fit                                                          | How it compares with LoggerJS                                                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native `console` | Development output and simple scripts                             | LoggerJS can capture console calls and route them, but direct console remains the simplest debug output. It is not a structured delivery pipeline.                                                      |
| `loglevel`       | Tiny browser/Node level filtering over console methods            | Much smaller and simpler. It does not try to provide transports, codecs, integrations, offline storage, or vendor delivery.                                                                             |
| `debug`          | Namespace-based debug traces toggled by environment/local storage | Excellent for library debug traces. It is not a structured production logging pipeline.                                                                                                                 |
| `consola`        | Pretty CLI/browser console output and developer tooling UX        | Strong for human-facing console UX, tags, reporters, console redirection, and prompts. LoggerJS is more focused on structured observability delivery.                                                   |
| `tslog`          | TypeScript-friendly pretty/JSON logger for Node and browser       | Closer to a full logger than `debug` or `loglevel`, with attachable transports. LoggerJS has a broader first-party automatic collection, transport reliability, and vendor/browser persistence surface. |

## Migration Friction

LoggerJS intentionally differs from Pino and Winston in a few places:

- LoggerJS takes `(message, data)` for normal logs; Pino commonly uses
  `(object, message)`.
- Stable metadata is split between `tags`, `bindings`, and ambient context
  instead of one generic `defaultMeta` or `base` object.
- Data shaping belongs in middleware/processors; serialization belongs in
  codecs attached to transports.
- Automatic capture is opt-in. Adding `captureConsoleIntegration()` or
  `captureFetchIntegration()` is explicit and reversible.

See [MIGRATION.md](MIGRATION.md) for examples.

## Claims We Should Not Make

Keep marketing and README claims inside these boundaries unless new evidence is
added:

- Do not claim LoggerJS is universally faster than Pino. The measured direct
  Node JSON ranking is CPU/Node-V8 dependent; cite the benchmark matrix for the
  exact machines tested.
- Do not claim full Deno/Bun first-party support until the repo has tests and
  package metadata for those runtimes.
- Do not claim every vendor feature is richer than ecosystem plugins. LoggerJS
  intentionally ships wire-protocol transports for common destinations; mature
  vendor SDKs may expose deeper platform-specific behavior.
- Do not claim browser automatic collection is unique across all packages. The
  supportable claim is that no equivalent first-party suite was found in the
  checked docs for Pino, Winston, LogTape, or Bunyan.
- Do not use old benchmark snapshots. Re-run `pnpm bench:node` before changing
  performance claims.
