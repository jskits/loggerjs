# loggerjs

**Isomorphic structured logging for JavaScript — one pipeline from browser to server, built for automatic collection, composable processing, and measured performance.**

LoggerJS is a monorepo of logging packages around a dependency-free, platform-neutral core. It is organized around three user-facing concepts plus one boundary rule:

- **Integrations** collect logs automatically from platform behavior — browser console calls, script errors, fetch/XHR failures, Web Vitals, route changes, Node process crashes, HTTP servers, serverless handlers, queue and database clients. All opt-in.
- **Middleware / processors** synchronously enrich, redact, sample, dedupe, rate-limit, fingerprint, buffer (fingers-crossed), route, and tag logs before delivery. Middleware run on raw records; processors run on projected events.
- **Transports** deliver logs anywhere — console, stdout, files, HTTP, IndexedDB, WebSocket, service workers, worker threads, OTLP, Sentry, Datadog, Elasticsearch, Loki, CloudWatch, SQL databases — with shared batching, retry, backoff, and circuit-breaker machinery.
- **Codecs belong to transports.** The pipeline keeps values raw; each destination owns its serialization. Built-in codecs are fast by default and never lose a log to an encoding error.

## Why LoggerJS

- **Truly isomorphic.** The core has zero dependencies, zero platform APIs, and a type surface that compiles without DOM libs. The same logger code runs in Node, browsers, workers, and edge runtimes.
- **Automatic collection as a first-class concept.** Most loggers stop at `logger.info()`. LoggerJS ships 24 integrations that turn platform behavior into structured logs, with re-entrancy guards and unpatched-original registries so capture never loops.
- **Performance with receipts.** Disabled levels cost ~5ns (at parity with pino). The full NDJSON path runs at ~85% of pino for equivalent output while carrying a record pipeline pino doesn't have — and the numbers are [measured, published](docs/BENCHMARKS.md), and enforced by a CI regression gate. The deliberate trade-off is [documented](docs/ARCHITECTURE.md).
- **Logs survive bad days.** Crash-path `flushSync`, beacon delivery on page close, offline queues with replay, batch retry with circuit breakers, codecs that fall back instead of throwing on circular references, and meta counters for every silent degradation.
- **Library-author friendly.** `getLogger(["my-lib"])` is a no-op until the host application calls `configure()` — log from libraries without forcing a logging dependency decision on users.

## Packages

| Package | Contents |
| --- | --- |
| `@loggerjs/core` | Logger, record/event model, registry, context, middleware kernel, integration API, console/memory/test/batch transports, json/safe-json/ndjson codecs |
| `@loggerjs/browser` | HTTP/IndexedDB/WebSocket/service-worker/broadcast-channel transports, offline queues, ZIP export, 14 browser integrations |
| `@loggerjs/node` | stdout/stderr/file/rotating-file/HTTP/syslog/worker transports, AsyncLocalStorage context, 10 Node integrations |
| `@loggerjs/processors` | redact, privacy-guard, sample, dynamic-sampler, rate-limit, dedupe, fingerprint, filter, route, level-override, normalize-error, stack-parser, enrich, tags, trace, fingers-crossed, breadcrumbs, schema-dev-check |
| `@loggerjs/codecs` | fast-event-json (the performance codec), built-in msgpackr, projector |
| `@loggerjs/otel` | OTLP JSON mapping, OTLP/HTTP transport, OpenTelemetry log bridge, active-span trace processor |
| `@loggerjs/sentry` | Sentry structured logs, breadcrumbs, exception/message capture |
| `@loggerjs/datadog` | Datadog Logs intake transport |
| `@loggerjs/elastic` | Elasticsearch bulk API transport |
| `@loggerjs/loki` | Grafana Loki push transport |
| `@loggerjs/cloudwatch` | CloudWatch Logs transport with built-in SigV4 signing |
| `@loggerjs/database` | SQLite/Postgres/custom-adapter batch transports |

All packages ship ESM + CJS with full TypeScript declarations and granular subpath exports (`@loggerjs/node/transport-stdout`, `@loggerjs/browser/integration-console`, …). Vendor transports speak wire protocols directly — no vendor SDKs bundled.

## Quick Start — Node

```ts
import { captureProcessIntegration, createLogger, stdoutTransport } from "@loggerjs/node";
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
logger.error(new Error("card declined"), "payment failed", { orderId: "ord_123" });

await logger.flush();
```

## Quick Start — Browser

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

Logs batch over HTTP, queue while offline, replay with backoff when the network returns, and flush via `sendBeacon` when the tab closes.

## Quick Start — Library Authors

```ts
// inside your library — silent until the app configures it
import { getLogger } from "@loggerjs/core";
const logger = getLogger(["my-lib", "client"]);
logger.debug("handshake started");

// inside the application
import { configure } from "@loggerjs/core";
import { stdoutTransport } from "@loggerjs/node";

await configure({
  transports: { stdout: stdoutTransport() },
  loggers: [{ category: ["my-lib"], level: "warn", transports: ["stdout"] }],
});
```

## Typed Events

```ts
import { defineEvent } from "@loggerjs/core";

const CheckoutCompleted = defineEvent<{ orderId: string; amountCents: number }>({
  type: "checkout.completed",
  message: (event) => `checkout completed ${event.orderId}`,
  tags: { domain: "checkout" },
});

logger.event(CheckoutCompleted, { orderId: "ord_123", amountCents: 4999 });
```

## Context

```ts
import { withContext } from "@loggerjs/core";
import { installAsyncLocalStorageContext } from "@loggerjs/node";

installAsyncLocalStorageContext(); // once at startup

await withContext({ requestId: "req_123" }, async () => {
  logger.info("request started"); // carries { requestId } across awaits
});
```

## Performance

Measured on Node 22 / Apple Silicon, full methodology and snapshot in [docs/BENCHMARKS.md](docs/BENCHMARKS.md):

| Path | ns/op |
| --- | ---: |
| Disabled level call (lazy message) | ~5 (pino: ~6) |
| Enabled pipeline, record fast path | ~101 |
| Batch transport enqueue | ~163 |
| Full NDJSON line, lean envelope | ~268 (~85% of pino) |
| Full NDJSON line with id/seq/levelName | ~303 |
| Node console, noop stream | ~549 |
| winston, same path | ~2,436 |
| LogTape, same path | ~4,842 |

The hot path is engineered — level gating before any allocation, lazy message resolution, frozen shared tags, memoized ids, a record fast path that skips event projection, fragment-cached serialization — and guarded by `pnpm bench:gate` in CI. The remaining gap to pino is a [documented architectural decision](docs/ARCHITECTURE.md), not an accident: LoggerJS allocates one record per log so middleware, integrations, and multiple transports can observe it.

## Documentation

| Doc | Contents |
| --- | --- |
| [Getting Started](docs/GETTING-STARTED.md) | Install, first loggers, levels, context, typed events, registry |
| [Concepts](docs/CONCEPTS.md) | The pipeline model: records, events, middleware, processors, transports, codecs |
| [Transports](docs/TRANSPORTS.md) | Every built-in transport, batch reliability options, writing your own |
| [Integrations](docs/INTEGRATIONS.md) | All 24 integrations, the integration API, writing your own |
| [Processors](docs/PROCESSORS.md) | The middleware/processor toolbox and ordering guidance |
| [Codecs](docs/CODECS.md) | Serialization ownership, fast-by-default semantics, custom codecs |
| [Performance](docs/PERFORMANCE.md) | Tuning guide: fast path, codec choice, batching |
| [Operations](docs/OPERATIONS.md) | Privacy defaults, offline queues, crash paths, delivery reliability |
| [Benchmarks](docs/BENCHMARKS.md) | Methodology, measured snapshot, regression gate, size budgets |
| [Comparison](docs/COMPARISON.md) | How LoggerJS compares with Pino, Winston, LogTape, Bunyan, and lighter console tools |
| [Migration](docs/MIGRATION.md) | Coming from pino, winston, or console.log |
| [Architecture](docs/ARCHITECTURE.md) | The full design document and recorded decisions |
| [Contributing](docs/CONTRIBUTING.md) | Repo workflow, CI gates, engineering conventions |
| [Release](docs/RELEASE.md) | Versioning and publish workflow |

Runnable examples live in [`examples/`](examples): Node basics, browser basics, OpenTelemetry, Sentry.

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
