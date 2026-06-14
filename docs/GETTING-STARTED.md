# Getting Started

LoggerJS is an isomorphic structured logging SDK. The same core API runs in Node, browsers, workers, and edge runtimes; platform packages add transports and automatic collection on top.

## Install

Pick the package for your platform. Each platform package re-exports everything from `@loggerjs/core`, so one install is enough to start.

```bash
# Node services
pnpm add @loggerjs/node @loggerjs/processors

# Browser apps
pnpm add @loggerjs/browser @loggerjs/processors
```

All packages ship ESM and CJS entry points with full TypeScript declarations.

## First Logger (Node)

```ts
import { captureProcessIntegration, createLogger, stdoutTransport } from "@loggerjs/node";
import { redactProcessor } from "@loggerjs/processors";

const logger = createLogger({
  category: ["api"],
  level: "info",
  tags: { service: "checkout", env: process.env.NODE_ENV ?? "dev" },
  processors: [redactProcessor()],
  transports: [stdoutTransport()],
  integrations: [captureProcessIntegration()],
});

logger.info("order created", { orderId: "ord_123" });
logger.error("payment failed", new Error("card declined"));

await logger.flush();
```

`stdoutTransport()` writes one NDJSON line per log. `captureProcessIntegration()` turns uncaught exceptions, unhandled rejections, and process warnings into log events automatically.

## First Logger (Browser)

```ts
import {
  browserHttpTransport,
  captureBrowserErrorsIntegration,
  captureConsoleIntegration,
  createLogger,
  memoryBrowserHttpOfflineQueue,
  pageLifecycleIntegration,
} from "@loggerjs/browser";

const logger = createLogger({
  category: ["web"],
  level: "info",
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
    pageLifecycleIntegration(),
  ],
});

logger.info("page loaded");
```

The HTTP transport batches logs, queues them while offline, replays on `online`, and falls back to `navigator.sendBeacon` when the page is closing.

## Levels

Six enabled levels plus `silent`:

| Name | Value |
| --- | ---: |
| `trace` | 10 |
| `debug` | 20 |
| `info` | 30 |
| `warn` | 40 |
| `error` | 50 |
| `fatal` | 60 |

```ts
logger.setLevel("debug");
logger.isLevelEnabled("trace"); // false
```

Disabled levels cost one numeric comparison — no allocation, no context lookup, no message formatting.

## Lazy Messages

Pass a function when building the message is expensive. It is only called if the level is enabled, and at most once:

```ts
logger.debug(() => `cart state: ${JSON.stringify(cart)}`);
```

## Errors

An `Error` as the first argument becomes the record's error, with an optional explicit message:

```ts
logger.error(err);
logger.error(err, "payment failed", { orderId: "ord_123" });
```

Errors are normalized (name, message, truncated stack, enumerable properties, cause chain) before transports see them.

## Child Loggers and Tags

```ts
const checkoutLogger = logger.child({
  category: ["api", "checkout"],
  tags: { domain: "checkout" },
});
```

Children inherit level, tags, bindings, middleware, processors, and transports; integrations are not inherited. `withTags()` and `withType()` are shorthands for common child shapes.

## Ambient Context

Bind request-scoped values once instead of threading them through every call:

```ts
import { withContext } from "@loggerjs/core";
import { installAsyncLocalStorageContext } from "@loggerjs/node";

installAsyncLocalStorageContext(); // once at startup

await withContext({ requestId: "req_123" }, async () => {
  logger.info("request started"); // context: { requestId: "req_123" }
});
```

In the browser the default stack-based context manager covers synchronous scopes; in Node, AsyncLocalStorage carries context across `await` boundaries.

## Typed Events

Define reusable, typed event shapes:

```ts
import { defineEvent } from "@loggerjs/core";

const CheckoutCompleted = defineEvent<{ orderId: string; amountCents: number }>({
  type: "checkout.completed",
  message: (event) => `checkout completed ${event.orderId}`,
  tags: { domain: "checkout" },
});

logger.event(CheckoutCompleted, { orderId: "ord_123", amountCents: 4999 });
```

## Library Authors: the Registry

Libraries should not construct loggers; they look one up by category and stay silent until the host application configures output:

```ts
// In the library
import { getLogger } from "@loggerjs/core";
const logger = getLogger(["my-lib", "client"]);
logger.debug("handshake started"); // no-op until configured

// In the application
import { configure } from "@loggerjs/core";
await configure({
  transports: { stdout: stdoutTransport() },
  loggers: [{ category: ["my-lib"], level: "warn", transports: ["stdout"] }],
});
```

## Shutdown

```ts
await logger.flush(); // drain pending transport work
await logger.close(); // tear down integrations, close transports
```

For crash paths, transports that support it expose `flushSync()`; see [OPERATIONS.md](OPERATIONS.md).

## Next Steps

- [CONCEPTS.md](CONCEPTS.md) — the pipeline model: records, events, middleware, processors, transports, codecs.
- [TRANSPORTS.md](TRANSPORTS.md) — every built-in transport and how to write your own.
- [INTEGRATIONS.md](INTEGRATIONS.md) — automatic collection for browser and Node.
- [PROCESSORS.md](PROCESSORS.md) — the middleware/processor toolbox.
- [CODECS.md](CODECS.md) — serialization ownership and the codec contract.
- [PERFORMANCE.md](PERFORMANCE.md) — configuring for throughput.
- [OPERATIONS.md](OPERATIONS.md) — privacy, offline queues, crash paths.
- [PRODUCTION-RECIPES.md](PRODUCTION-RECIPES.md) — browser HTTP/offline, Node stdout+OTLP, Loki/Datadog deployments.
- [API-STABILITY.md](API-STABILITY.md) — v1 stable API subset and pre-1.0 compatibility policy.
- [MIGRATION.md](MIGRATION.md) — coming from pino, winston, or console.
