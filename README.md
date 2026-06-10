# loggerjs

`loggerjs` is an isomorphic structured logging SDK for browser and server-side JavaScript. It is built around three user-facing concepts plus one transport-owned serialization boundary:

- **Integrations** automatically collect logs from platform behavior, such as browser console calls, script errors, fetch/XHR failures, page lifecycle flushes, Node process errors, and diagnostics channels.
- **Middleware/processors** synchronously enrich, redact, sample, tag, type, dedupe, or attach trace context before logs reach transports.
- **Transports** deliver logs to a destination, such as console, stdout, file, HTTP, OTLP, Sentry, a worker, or a custom sink.
- **Codecs** belong to transports and own serialization. Middleware keeps raw values and does not stringify the record.

The core package is dependency-free and platform-neutral. Browser, Node, OTLP, Sentry, codecs, and processor packages layer on top.

## Packages

```txt
@loggerjs/core        Logger, event model, context, codecs, console/memory/batch transports
@loggerjs/browser     Browser HTTP transport and console/error/fetch/XHR/page lifecycle integrations
@loggerjs/node        stdout/stderr/file/http/worker transports, AsyncLocalStorage context, process and diagnostics integrations
@loggerjs/processors  Redact, sample, tags, type, dedupe, trace processors
@loggerjs/codecs      Fast fixed-shape JSON, msgpackr adapter, projector codec
@loggerjs/otel        OTLP JSON mapping, OTLP HTTP transport, active span trace processor
@loggerjs/sentry      Sentry structured logs, breadcrumbs, exception/message capture transport
```

## Basic Node Usage

```ts
import { captureProcessIntegration, createLogger, stdoutTransport } from "@loggerjs/node";
import { redactProcessor, tagsProcessor } from "@loggerjs/processors";

const logger = createLogger({
  name: "api",
  level: "info",
  tags: { service: "checkout", env: process.env.NODE_ENV ?? "dev" },
  processors: [redactProcessor(), tagsProcessor({ runtime: "node" })],
  transports: [stdoutTransport()],
  integrations: [captureProcessIntegration()],
});

logger.info("order created", { orderId: "ord_123", token: "secret" });
await logger.flush();
```

## Basic Browser Usage

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
  name: "web",
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

## Typed Events

```ts
import { createLogger, defineEvent } from "@loggerjs/core";

const CheckoutCompleted = defineEvent<{ orderId: string; amountCents: number }>({
  type: "checkout.completed",
  message: (event) => `checkout completed ${event.orderId}`,
  tags: { domain: "checkout" },
});

const logger = createLogger();
logger.event(CheckoutCompleted, { orderId: "ord_123", amountCents: 4999 });
```

## Operational Docs

- [Architecture](docs/ARCHITECTURE.md)
- [Privacy, offline queue, and crash-path guidance](docs/OPERATIONS.md)
- [Benchmarks and size budgets](docs/BENCHMARKS.md)
- [Migration notes](docs/MIGRATION.md)
- [Release workflow](docs/RELEASE.md)

## Development

```bash
pnpm install
pnpm check
pnpm bench
pnpm release:dry-run
```

`pnpm check` runs formatting, linting, typechecks, tests, builds, size budgets, package export checks, public type checks, API report checks, and npm pack validation.
