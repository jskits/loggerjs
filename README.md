<div align="center">

# LoggerJS

**Isomorphic structured logging for JavaScript — one pipeline from browser to server, built for automatic collection, composable processing, and measured performance.**

[![CI](https://github.com/jskits/loggerjs/actions/workflows/ci.yml/badge.svg)](https://github.com/jskits/loggerjs/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@loggerjs/core.svg)](https://www.npmjs.com/package/@loggerjs/core)
[![license](https://img.shields.io/npm/l/@loggerjs/core)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](tsconfig.base.json)
[![core dependencies](https://img.shields.io/badge/core_deps-0-44CC11)](packages/core/package.json)
[![Node](https://img.shields.io/badge/Node-%E2%89%A522.13-339933?logo=node.js&logoColor=white)](package.json)
[![modules](https://img.shields.io/badge/modules-ESM%20%2B%20CJS-F7DF1E)](#packages)

[Getting Started](docs/GETTING-STARTED.md) · [Concepts](docs/CONCEPTS.md) · [Transports](docs/TRANSPORTS.md) · [Integrations](docs/INTEGRATIONS.md) · [Benchmarks](docs/BENCHMARKS.md) · [Comparison](docs/COMPARISON.md) · [Architecture](docs/ARCHITECTURE.md)

<sub>**12 packages** · **35 integrations** (**19 browser / 16 Node.js**) · **25+ transports** (core / browser / Node.js / vendor) · **27 runtime-neutral processors** · **8 codecs** · **zero-dependency core**</sub>

</div>

---

LoggerJS is a monorepo of logging packages around a dependency-free, platform-neutral core. The same logger code runs in Node, browsers, workers, and edge runtimes. It is organized around three user-facing concepts plus one boundary rule:

- **Integrations** collect logs automatically from platform behavior — browser console calls, script errors, fetch/XHR failures, Web Vitals, route changes, Node process crashes, HTTP servers, serverless handlers, queue and database clients. All opt-in.
- **Middleware / processors** synchronously enrich, redact, sample, dedupe, rate-limit, fingerprint, buffer (fingers-crossed), route, and tag logs before delivery. Middleware run on raw records; processors run on projected events.
- **Transports** deliver logs anywhere — console, stdout, files, HTTP, IndexedDB, WebSocket, service workers, worker threads, OTLP, Sentry, Datadog, Elasticsearch, Loki, CloudWatch, SQL databases — with reusable batching, retry, backoff, and circuit-breaker wrappers where the destination needs them.
- **Codecs belong to transports.** The pipeline keeps values raw; each destination owns its serialization. Built-in codecs are fast by default and never lose a log to an encoding error.

<table>
<tr>
<td width="50%" valign="top">

🌐 **Truly isomorphic**<br/>
Zero-dependency core, zero platform APIs, a type surface that compiles without DOM libs. One logger for Node, browsers, workers, and edge.

</td>
<td width="50%" valign="top">

🎣 **Automatic collection, first-class**<br/>
35 opt-in integrations — 19 browser/frontend and 16 Node.js/server — turn platform behavior into structured logs.

</td>
</tr>
<tr>
<td width="50%" valign="top">

⚡ **Performance with receipts**<br/>
Disabled levels cost ~2-5ns (pino parity). The lean NDJSON path runs at ~84% of pino (≈1.20×) — [measured](docs/BENCHMARKS.md), published, and CI-gated.

</td>
<td width="50%" valign="top">

🛟 **Logs survive bad days**<br/>
Crash-path `flushSync`, beacon on page close, offline replay, batch retry with circuit breakers, codecs that fall back instead of throwing.

</td>
</tr>
<tr>
<td width="50%" valign="top">

🧩 **Composable pipeline**<br/>
27 runtime-neutral middleware and processors enrich, redact, sample, dedupe, rate-limit, fingerprint, route, and buffer — on raw records or projected events.

</td>
<td width="50%" valign="top">

📚 **Library-author friendly**<br/>
`getLogger(["my-lib"])` is a silent no-op until the host app calls `configure()` — log from libraries without forcing a dependency on users.

</td>
</tr>
</table>

## Table of Contents

- [Install](#install)
- [Quick Start](#quick-start)
  - [Node](#node)
  - [Browser](#browser)
  - [Library authors](#library-authors)
- [How It Works](#how-it-works)
- [Typed Events](#typed-events)
- [Context Propagation](#context-propagation)
- [Performance](#performance)
- [Packages](#packages)
- [The Ecosystem](#the-ecosystem)
- [How It Compares](#how-it-compares)
- [Documentation](#documentation)
- [Development](#development)
- [License](#license)

## Install

Pick the package for your platform. Each platform package **re-exports all of `@loggerjs/core`**, so one install per app is enough to start.

```bash
# Node services
npm install @loggerjs/node @loggerjs/processors

# Browser apps
npm install @loggerjs/browser @loggerjs/processors
```

<sub>Using pnpm or yarn? Swap `npm install` for `pnpm add` / `yarn add`. Add vendor packages (`@loggerjs/otel`, `@loggerjs/sentry`, `@loggerjs/datadog`, …) only when you deliver to that destination.</sub>

All packages ship **ESM + CJS** with full TypeScript declarations and granular subpath exports (`@loggerjs/node/transport-stdout`, `@loggerjs/browser/integration-console`, …) so bundlers tree-shake to exactly what you import.

## Quick Start

### Node

```ts
import {
  captureProcessIntegration,
  createLogger,
  stdoutTransport,
} from "@loggerjs/node";
import { redactProcessor } from "@loggerjs/processors";

const logger = createLogger({
  category: ["api"],
  level: "info",
  tags: { service: "checkout", env: process.env.NODE_ENV ?? "dev" },
  processors: [redactProcessor({ keys: ["password", /token/i] })],
  transports: [stdoutTransport()],
  integrations: [captureProcessIntegration()],
});

logger.info("order created", { orderId: "ord_123" });
logger.error(new Error("card declined"), "payment failed", {
  orderId: "ord_123",
});

await logger.flush();
```

`stdoutTransport()` writes one NDJSON line per log; `captureProcessIntegration()` turns uncaught exceptions, unhandled rejections, and process warnings into structured events automatically.

### Browser

```ts
import {
  browserHttpTransport,
  captureBrowserErrorsIntegration,
  captureConsoleIntegration,
  captureFetchIntegration,
  createLogger,
  memoryBrowserHttpOfflineQueue,
  pageLifecycleIntegration,
} from "@loggerjs/browser";
import { redactProcessor } from "@loggerjs/processors";

const logger = createLogger({
  category: ["web"],
  level: "info",
  processors: [redactProcessor()],
  transports: [
    browserHttpTransport({
      url: "/api/logs",
      offlineQueue: memoryBrowserHttpOfflineQueue({ maxEntries: 500 }),
      useBeaconOnPageHide: true,
    }),
  ],
  integrations: [
    captureConsoleIntegration({ levels: ["warn", "error"] }),
    captureBrowserErrorsIntegration(),
    captureFetchIntegration(),
    pageLifecycleIntegration(),
  ],
});

logger.info("page loaded");
```

Logs batch over HTTP, queue while offline, replay with backoff when the network returns, and attempt a best-effort `sendBeacon` flush when the tab closes.

### Library authors

```ts
// inside your library — silent until the app configures it
import { getLogger } from "@loggerjs/core";

const logger = getLogger(["my-lib", "client"]);
logger.debug("handshake started"); // no-op until configure() runs

// inside the application
import { configure } from "@loggerjs/core";
import { stdoutTransport } from "@loggerjs/node";

await configure({
  transports: { stdout: stdoutTransport() },
  loggers: [{ category: ["my-lib"], level: "warn", transports: ["stdout"] }],
});
```

## How It Works

Every log flows through one pipeline. The hot path is engineered to do as little as possible until a value is actually needed.

```
  logger.info("order created", { orderId })
        │
        ▼  level gate ──── disabled levels stop here (~5ns, no allocation)
        │
  ┌─────────────┐   lazy message · raw error · shared ctx/tags · no id yet
  │  LogRecord  │
  └──────┬──────┘
         │
   middleware ───────── sync · ordered · enrich / redact / drop on raw records
         │
   any processors? ──no──▶  record fast path — straight to transports, no projection
         │ yes
         ▼
  ┌─────────────┐   id assigned · message resolved · error normalized
  │  LogEvent   │
  └──────┬──────┘
         │
   processors ───────── sample · dedupe · fingerprint · route · fingers-crossed
         │
         ▼
   transports ───────── console · stdout · file · http · indexeddb · otlp · sentry · …
         │               shared batching · retry · backoff · circuit breaker
         ▼
   codec ────────────── each destination owns its serialization (fast, never throws)
```

`LogRecord` is the hot-path shape — it keeps the message function unevaluated, the error raw, and context/tags shared by reference. A logger with **zero processors** sends records straight to transports (the _record fast path_, no event projection). Adding any processor opts that logger into `LogEvent` projection so processors can see the resolved shape. See [CONCEPTS.md](docs/CONCEPTS.md) for the full model.

## Typed Events

Define an event once and log it with a checked payload — message and tags derive from the data.

```ts
import { defineEvent } from "@loggerjs/core";

const CheckoutCompleted = defineEvent<{ orderId: string; amountCents: number }>(
  {
    type: "checkout.completed",
    message: (event) => `checkout completed ${event.orderId}`,
    tags: { domain: "checkout" },
  },
);

logger.event(CheckoutCompleted, { orderId: "ord_123", amountCents: 4999 });
```

## Context Propagation

Bind fields once and have them follow async execution across every `await` — no manual threading.

```ts
import { withContext } from "@loggerjs/core";
import { installAsyncLocalStorageContext } from "@loggerjs/node";

installAsyncLocalStorageContext(); // once at startup

await withContext({ requestId: "req_123" }, async () => {
  logger.info("request started"); // carries { requestId } across awaits
});
```

## Performance

Measured on an Apple Silicon laptop, Node v22.22.2, against pino 10.3.1 / winston 3.19.0 / LogTape 2.1.3. Each scenario logs one structured line into a discarding sink; full methodology and the regression gate live in [docs/BENCHMARKS.md](docs/BENCHMARKS.md).

| Logger / path                                      |   ns/op | Relative                          |
| -------------------------------------------------- | ------: | --------------------------------- |
| **loggerjs** — disabled level (lazy message)       |   **2** | parity with pino (7)              |
| **loggerjs** — batch transport enqueue             | **173** | —                                 |
| **loggerjs** — lean NDJSON, comparable line        | **267** | **~84% of pino (≈1.20×)**         |
| **loggerjs** — full envelope (`+id/seq/levelName`) | **301** | ~74% of pino, 3 extra fields/line |
| pino — NDJSON noop sink                            |     224 | 1.00× baseline                    |
| Node `console` — noop stream                       |     698 | loggerjs ~2.6× faster             |
| winston — JSON noop sink                           |   2,723 | loggerjs ~10× faster              |
| LogTape — JSON lines noop sink                     |   5,057 | loggerjs ~19× faster              |

The hot path is deliberate: level gating before any allocation, lazy message resolution, frozen shared tags, memoized ids, a record fast path that skips event projection, and fragment-cached serialization — all guarded by `pnpm bench:gate` in CI. The remaining gap to pino is a [documented architectural decision](docs/ARCHITECTURE.md), not an accident: LoggerJS allocates one record per log so middleware, integrations, and multiple transports can observe it. pino builds its line directly from call arguments and carries no such pipeline.

## Packages

| Package                                       | Contents                                                                                                                                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`@loggerjs/core`](packages/core)             | Logger, record/event model, registry, context, middleware kernel, integration API, console/memory/test/batch transports, json/safe-json/ndjson codecs. **Zero dependencies.**                                      |
| [`@loggerjs/browser`](packages/browser)       | HTTP / IndexedDB / WebSocket / service-worker / broadcast-channel transports, offline queues, ZIP export, **19 browser integrations**                                                                              |
| [`@loggerjs/node`](packages/node)             | stdout / stderr / file / rotating-file / HTTP / syslog / worker transports, AsyncLocalStorage context, **16 Node integrations**                                                                                    |
| [`@loggerjs/processors`](packages/processors) | redact, privacy-guard, sample, dynamic-sampler, rate-limit, dedupe, fingerprint, filter, route, level-override, normalize-error, stack-parser, enrich, tags, trace, fingers-crossed, breadcrumbs, schema-dev-check |
| [`@loggerjs/codecs`](packages/codecs)         | fast-event-json (the performance codec), msgpackr, projector                                                                                                                                                       |
| [`@loggerjs/otel`](packages/otel)             | OTLP JSON mapping, OTLP/HTTP transport, OpenTelemetry log bridge, active-span trace processor                                                                                                                      |
| [`@loggerjs/sentry`](packages/sentry)         | Sentry structured logs, breadcrumbs, exception/message capture                                                                                                                                                     |
| [`@loggerjs/datadog`](packages/datadog)       | Datadog Logs intake transport                                                                                                                                                                                      |
| [`@loggerjs/elastic`](packages/elastic)       | Elasticsearch bulk API transport                                                                                                                                                                                   |
| [`@loggerjs/loki`](packages/loki)             | Grafana Loki push transport                                                                                                                                                                                        |
| [`@loggerjs/cloudwatch`](packages/cloudwatch) | CloudWatch Logs transport with built-in SigV4 signing                                                                                                                                                              |
| [`@loggerjs/database`](packages/database)     | SQLite / Postgres / custom-adapter batch transports                                                                                                                                                                |

Vendor HTTP transports speak wire protocols directly; SDK/provider adapters use the SDK object or provider your app already owns. **No vendor SDKs are bundled.**

## The Ecosystem

<details>
<summary><strong>Runtime support at a glance</strong> — what runs in browser, Node.js, or both</summary>

<br/>

| Capability family | Browser / frontend | Node.js / server | Runtime-neutral |
| --- | --- | --- | --- |
| Integrations | 19 first-party browser collectors | 16 first-party Node.js collectors | Core exposes the integration API; automatic capture lives in platform packages. |
| Transports | HTTP, IndexedDB, WebSocket, service worker, BroadcastChannel, offline-first | stdout/stderr, files, rotation, HTTP, syslog, worker threads, database-backed transports | console, memory, test, batch/retry/fallback wrappers; vendor HTTP transports can run where their credentials and fetch/runtime requirements are safe. |
| Processors / middleware | All 27 supported | All 27 supported | `@loggerjs/processors` has no browser or Node.js platform dependency; only routed transport targets are runtime-specific. |

See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md), [docs/TRANSPORTS.md](docs/TRANSPORTS.md), and [docs/PROCESSORS.md](docs/PROCESSORS.md) for the full support notes.

</details>

<details>
<summary><strong>25+ transports</strong> — core/browser/Node.js/vendor destinations plus reusable reliability wrappers</summary>

<br/>

**Core / runtime-neutral** (`@loggerjs/core`) — `consoleTransport` · `memoryTransport` · `testTransport`, plus reliability wrappers `batchTransport` · `retryTransport` · `fallbackTransport`

**Node.js / server** (`@loggerjs/node`) — `stdoutTransport` · `stderrTransport` · `fileTransport` · `rotatingFileTransport` · `nodeHttpTransport` · `nodeSyslogTransport` · `workerTransport`

**Browser / frontend** (`@loggerjs/browser`) — `browserHttpTransport` · `indexedDbTransport` · `browserWebSocketTransport` · `browserServiceWorkerTransport` · `browserBroadcastChannelTransport` · `offlineFirstTransport`

**Observability & vendors** — `otlpHttpTransport` · `openTelemetryLogBridgeTransport` · `sentryTransport` · `datadogLogsTransport` · `elasticTransport` · `lokiTransport` · `cloudWatchLogsTransport`. HTTP wire transports depend on `fetch`/crypto and credential placement; SDK/provider adapters use the SDK object or provider your app already owns.

**Databases / local app / backend** — `databaseTransport` · `postgresTransport` · `sqliteTransport`. These require application-provided database drivers and are intended for Node.js, Electron, CLIs, or backend workers.

See [docs/TRANSPORTS.md](docs/TRANSPORTS.md) for options and how to write your own.

</details>

<details>
<summary><strong>35 integrations</strong> — 19 browser/frontend + 16 Node.js/server automatic collectors</summary>

<br/>

**Browser** (19) —
_Console & errors:_ `captureConsoleIntegration` · `captureBrowserErrorsIntegration` · `captureFrameworkErrorsIntegration` · `captureReportingIntegration`
_Network:_ `captureFetchIntegration` · `captureXHRIntegration` · `captureWebSocketIntegration`
_Performance:_ `captureWebVitalsIntegration` · `capturePerformanceIntegration`
_Navigation:_ `captureRouterIntegration` · `nextRouterIntegration` · `reactRouterIntegration` · `vueRouterIntegration` · `nuxtRouterIntegration`
_Lifecycle & context:_ `pageLifecycleIntegration` · `captureUserActionsIntegration` · `captureServiceWorkerIntegration` · `captureRuntimeHostIntegration` · `browserContextPropagationIntegration`

**Node** (16) —
_Process & runtime:_ `captureProcessIntegration` · `captureCliIntegration` · `diagnosticsChannelIntegration` · `serverlessIntegration`
_HTTP frameworks:_ `expressIntegration` · `fastifyIntegration` · `koaIntegration` · `hapiIntegration` · `nestMiddlewareIntegration`
_Clients:_ `nodeFetchIntegration` · `nodeHttpClientIntegration` · `redisIntegration` · `prismaIntegration` · `databaseIntegration`
_Queues:_ `queueIntegration` · `bullMqIntegration`

Every integration uses re-entrancy guards and an unpatched-original registry so capture never loops. See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) for the integration API and how to write your own.

</details>

<details>
<summary><strong>27 processors &amp; middleware</strong> — runtime-neutral, synchronous, error-isolated, composable</summary>

<br/>

_Redaction & privacy:_ `redactProcessor` · `privacyGuardProcessor`
_Sampling & volume:_ `sampleProcessor` · `dynamicSamplerProcessor` · `rateLimitProcessor` · `dedupeProcessor` · `coalesceProcessor`
_Enrichment & tagging:_ `enrichProcessor` / `enrichMiddleware` · `tagsProcessor` / `tagsMiddleware` · `typeProcessor` / `typeMiddleware` · `contextProcessor` / `contextMiddleware` · `traceContextProcessor` / `traceContextMiddleware`
_Errors:_ `normalizeErrorProcessor` · `fingerprintProcessor` · `stackParserProcessor` · `symbolicateStackProcessor`
_Routing & control:_ `routeProcessor` · `filterProcessor` · `levelOverrideProcessor`
_Buffering:_ `fingersCrossedProcessor` · `breadcrumbBufferProcessor`
_Development:_ `schemaDevCheckProcessor`

Middleware run on raw records before id/message/error work; processors run on projected events. The processor package is platform-neutral and works in browser, Node.js, workers, and edge runtimes; only route/fingers-crossed targets depend on transports available in that runtime. See [docs/PROCESSORS.md](docs/PROCESSORS.md) for ordering guidance.

</details>

<details>
<summary><strong>8 codecs</strong> — serialization owned by the transport, fast by default, never throws</summary>

<br/>

`jsonCodec` · `safeJsonCodec` · `ndjsonCodec` · `metricsCodec` (core) — `fastEventJsonCodec` (the performance codec) · `pinoCompatCodec` · `msgpackrCodec` · `projectorCodec` (`@loggerjs/codecs`).

Codecs fall back to a safe representation on circular references instead of throwing, and increment a `codec.fallback` meta counter so silent degradation is observable. See [docs/CODECS.md](docs/CODECS.md).

</details>

## How It Compares

LoggerJS shines when the logging problem spans **browser and server** collection from one mental model. A fair, repo-sourced snapshot (full matrix and sources in [docs/COMPARISON.md](docs/COMPARISON.md)):

| Capability                             | LoggerJS | Pino | Winston | LogTape |
| -------------------------------------- | :------: | :--: | :-----: | :-----: |
| Isomorphic (browser + Node, one API)   |    ✅    |  ⚠️  |   ⚠️    |   ✅    |
| Automatic collection (integrations)    |  ✅ 19 browser / 16 Node   |  ❌  |   ⚠️    |   ⚠️    |
| Built-in batching / retry / offline    |    ✅    |  ⚠️  |   ⚠️    |   ⚠️    |
| Transport-owned codecs                 |    ✅    |  ⚠️  |   ⚠️    |   ⚠️    |
| Library-safe (silent until configured) |    ✅    |  ⚠️  |   ⚠️    |   ✅    |
| Fastest direct Node JSON path          |   ~84%   |  ✅  | slower  | slower  |

Pino is still the best choice when the only requirement is the fastest direct Node JSON logger. LoggerJS trades a small, measured slice of that throughput for a record pipeline that works the same in the browser, captures automatically, and delivers reliably.

## Documentation

| Doc                                        | Contents                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------- |
| [Getting Started](docs/GETTING-STARTED.md) | Install, first loggers, levels, context, typed events, registry                 |
| [Concepts](docs/CONCEPTS.md)               | The pipeline model: records, events, middleware, processors, transports, codecs |
| [Transports](docs/TRANSPORTS.md)           | Every built-in transport, batch reliability options, writing your own           |
| [Integrations](docs/INTEGRATIONS.md)       | All integrations, the integration API, writing your own                         |
| [Processors](docs/PROCESSORS.md)           | The middleware/processor toolbox and ordering guidance                          |
| [Codecs](docs/CODECS.md)                   | Serialization ownership, fast-by-default semantics, custom codecs               |
| [Performance](docs/PERFORMANCE.md)         | Tuning guide: fast path, codec choice, batching                                 |
| [Operations](docs/OPERATIONS.md)           | Privacy defaults, offline queues, crash paths, delivery reliability             |
| [Benchmarks](docs/BENCHMARKS.md)           | Methodology, measured snapshot, regression gate, size budgets                   |
| [Comparison](docs/COMPARISON.md)           | How LoggerJS compares with Pino, Winston, LogTape, Bunyan, and lighter tools    |
| [Migration](docs/MIGRATION.md)             | Coming from pino, winston, or console.log                                       |
| [Architecture](docs/ARCHITECTURE.md)       | The full design document and recorded decisions                                 |
| [Contributing](docs/CONTRIBUTING.md)       | Repo workflow, CI gates, engineering conventions                                |
| [Release](docs/RELEASE.md)                 | Versioning and publish workflow                                                 |

Runnable examples live in [`examples/`](examples): [Node basics](examples/node-basic), [browser basics](examples/browser-basic), [OpenTelemetry](examples/otel-basic), [Sentry](examples/sentry-basic).

## Development

```bash
pnpm install
pnpm check        # format, lint, typecheck, test, build, size budgets, API reports, pack checks
pnpm bench        # node + browser benchmarks
pnpm bench:gate   # performance regression gate (also runs in CI)
```

See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for conventions and the rules CI enforces.

## License

[MIT](LICENSE) © JS Kits
