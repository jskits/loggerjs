# Migration Notes

LoggerJS is still pre-1.0, but the current codebase has moved from the initial skeleton toward the v1 architecture.

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
