# Integrations

Integrations collect logs automatically from platform behavior. They are always **opt-in**: nothing is captured until you configure the matching integration. Every capture is tagged with `source: "integration:<name>"` so downstream filtering and loop prevention work.

Privacy guidance for what to enable and how to sanitize lives in [OPERATIONS.md](OPERATIONS.md).

## Browser (`@loggerjs/browser`)

| Integration | Captures | Notes |
| --- | --- | --- |
| `captureConsoleIntegration()` | `console.debug/info/log/warn/error/trace` calls | Level allowlist (`levels`), rate limit (default 100/s). Patched methods restore on teardown; the console transport writes through unpatched methods, so no loops. |
| `captureBrowserErrorsIntegration()` | `window.onerror` script/resource errors, `unhandledrejection`, optional CSP violations | Deduplicates rapid identical script errors. |
| `captureFetchIntegration()` | Failed (status ≥ `minStatus`, default 400) and sampled successful `fetch` calls | Header allowlists, URL sanitizer. Errors re-throw to the app after capture. |
| `captureXHRIntegration()` | `XMLHttpRequest` lifecycle with status and duration | Same sanitization options as fetch. |
| `pageLifecycleIntegration()` | Flushes transports on `pagehide` / `visibilitychange` | Coalesces rapid flushes; pair with the HTTP transport's beacon mode. |
| `captureWebVitalsIntegration()` | CLS, FCP, INP, LCP, TTFB | Emits incremental and final values via PerformanceObserver. |
| `capturePerformanceIntegration()` | navigation, resource, longtask, measure, mark entries | Deduplicated, capped by `maxEntries`. |
| `captureUserActionsIntegration()` | clicks, inputs, submits | Per-element throttling; text/value capture is off by default. |
| `captureRouterIntegration()` | route changes (`pushState`/`replaceState`/`popstate`/`hashchange`) | Optional state normalization. |
| `captureReportingIntegration()` | ReportingObserver reports (CSP, deprecation, intervention, crash) | Drains pending reports on teardown. |
| `captureServiceWorkerIntegration()` | service worker lifecycle, messages, message errors | Message data capture off by default. |
| `captureWebSocketIntegration()` | WebSocket connect/open/close/error and sampled messages | Wraps the constructor; sockets created before setup are not tracked. |
| `captureFrameworkErrorsIntegration()` | React/Vue/Solid/Svelte error hooks | Exposes `reactComponentDidCatch()`, `vueErrorHandler()`, etc.; buffers errors raised before the logger exists (`maxPending`). |
| `captureRuntimeHostIntegration()` | browser-extension messages, Electron IPC on configured channels | Conservative default: no channels monitored. |

## Node (`@loggerjs/node`)

| Integration | Captures | Notes |
| --- | --- | --- |
| `captureProcessIntegration()` | `uncaughtException` (fatal), `unhandledRejection`, warnings, exit | `exitOnUncaught` flushes synchronously, then exits after a bounded async flush window. |
| `diagnosticsChannelIntegration()` | Node `diagnostics_channel` messages (http, undici, custom channels) | Message payload capture off by default. |
| `expressIntegration(logger)` | request completion with status, route, duration, request id | Returns an Express middleware; optional `withContext` binding per request. |
| `fastifyIntegration(logger)` | request lifecycle via onRequest/onError/onResponse hooks | Returns a Fastify plugin; state keyed in a WeakMap. |
| `nodeFetchIntegration()` | outgoing `fetch` calls with status and duration | Errors re-throw after capture. |
| `nodeHttpClientIntegration()` | `http.request` / `http.get` calls | |
| `captureCliIntegration()` | CLI start, exit code, SIGINT/SIGTERM | Sanitizes argv for token/password/secret patterns. |
| `serverlessIntegration(logger, handler)` | wraps a serverless handler: invocation, duration, cold start, errors | Supports promise, callback, and sync handlers. |
| `queueIntegration()` | queue client operations (publish/consume/ack/nack) with duration | Patches the methods you list per client. |
| `databaseIntegration()` | database client calls (query/execute/...) with statement and duration | Statement extracted from the first string arg or `.sql`/`.text`/`.query` properties. |

### Context manager

Not an integration, but installed the same way once at startup:

```ts
import { installAsyncLocalStorageContext } from "@loggerjs/node";
installAsyncLocalStorageContext();
```

After this, `withContext()` values follow async execution across `await` boundaries.

## Writing a Custom Integration

```ts
import type { Integration } from "@loggerjs/core";

export function captureThingIntegration(): Integration {
  return {
    name: "thing",
    setup(api) {
      const original = thing.onEvent;
      const capture = api.guard((payload: unknown) => {
        api.capture({
          level: "info",
          message: "thing event",
          data: { payload },
        });
      });

      thing.onEvent = (payload) => {
        capture(payload);
        return original(payload);
      };

      return () => {
        thing.onEvent = original;
      };
    },
  };
}
```

The setup context (`api`) gives you:

- `capture(input)` — the main entry point; stamps `source: "integration:thing"`.
- `log/trace/debug/info/warn/error/fatal/event/captureException` — direct logging methods when capture semantics do not fit.
- `guard(fn)` — wraps a callback with a re-entrancy counter. If your patched surface is itself triggered by the logging pipeline (the classic case: console capture + console transport), the recursive invocation is dropped and counted in meta (`integration.dropped.reentrant`) instead of recursing.
- `unpatched` — registry of original `console.*` / `fetch` / `XMLHttpRequest` implementations, shared across all integrations so double patching composes.
- `flush/flushSync/close` — for lifecycle-driven integrations like page hide.

Rules of the road:

- Always return a teardown that restores what you patched. Teardowns run once, in reverse setup order, on `logger.close()`.
- Setup is idempotent per integration *instance*; creating two instances patches twice. Export a factory and document it.
- Degrade gracefully: feature-detect the platform surface and no-op when it is missing.
- Capture raw structured data and let processors redact; do not pre-format messages.
