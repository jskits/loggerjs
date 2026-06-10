# loggerjs

`loggerjs` is a proposed isomorphic structured logging SDK for the `@loggerjs/*` npm organization.

It is designed around four explicit extension points:

1. **Core logger**: tiny hot-path logging API and event model.
2. **Processors**: synchronous event pipeline for redact, enrich, sample, normalize, dedupe, trace attach.
3. **Transports**: console, stdout, file, HTTP batch, OTLP, or any custom sink.
4. **Integrations**: automatic collection for console, browser errors, fetch, XHR, process errors, page lifecycle.
5. **Codecs**: JSON, safe JSON, NDJSON, fast fixed-shape JSON, and pluggable binary codecs.

## Packages

```txt
@loggerjs/core        Core logger, event model, codecs, console/memory/batch transports
@loggerjs/browser     Browser HTTP transport and browser integrations
@loggerjs/node        Node stdout/file/http transports and process integration
@loggerjs/processors  Redact, sample, tags, type, dedupe, trace processors
@loggerjs/codecs      Fast fixed-shape JSON, msgpackr adapter, projector codec
@loggerjs/otel        OTLP JSON mapping and transport
```

## Basic Node usage

```ts
import { createLogger, stdoutTransport, captureProcessIntegration } from "@loggerjs/node";
import { redactProcessor } from "@loggerjs/processors";

const logger = createLogger({
  name: "api",
  level: "info",
  tags: { service: "checkout", env: "prod" },
  processors: [redactProcessor()],
  transports: [stdoutTransport()],
  integrations: [captureProcessIntegration()]
});

logger.info("order created", { orderId: "ord_123", token: "secret" });
```

## Basic browser usage

```ts
import {
  createLogger,
  browserHttpTransport,
  captureConsoleIntegration,
  captureBrowserErrorsIntegration,
  captureFetchIntegration
} from "@loggerjs/browser";
import { redactProcessor } from "@loggerjs/processors";

const logger = createLogger({
  name: "web",
  level: "info",
  processors: [redactProcessor()],
  transports: [browserHttpTransport({ url: "/api/logs" })],
  integrations: [
    captureConsoleIntegration({ levels: ["warn", "error"] }),
    captureBrowserErrorsIntegration(),
    captureFetchIntegration()
  ]
});

logger.info("page loaded");
```

## Build

```bash
pnpm install
pnpm build
```

## Publish order

```bash
pnpm --filter @loggerjs/core publish --access public
pnpm --filter @loggerjs/processors publish --access public
pnpm --filter @loggerjs/codecs publish --access public
pnpm --filter @loggerjs/browser publish --access public
pnpm --filter @loggerjs/node publish --access public
pnpm --filter @loggerjs/otel publish --access public
```

## Design rules

- The logging hot path performs level gating before event construction.
- Processors are synchronous by design. Heavy work belongs in transports, workers, or backends.
- Transports must never throw into application code; internal errors are routed to `onInternalError`.
- Browser integrations are opt-in because automatic collection has privacy and performance implications.
- JSON/NDJSON are built in for interoperability; binary codecs are adapters so users can opt into size/performance tradeoffs.
