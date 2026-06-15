# Integrations

Integrations collect logs automatically from platform behavior. They are always **opt-in**: nothing is captured until you configure the matching integration. Every capture is tagged with `source: "integration:<name>"` so downstream filtering and loop prevention work.

Privacy guidance for what to enable and how to sanitize lives in [OPERATIONS.md](OPERATIONS.md).

## Runtime Support

| Runtime                | Support                                                 | Count | Notes                                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser / frontend     | First-party automatic collectors in `@loggerjs/browser` | 19    | Console, script errors, fetch/XHR, WebSocket, Web Vitals, Performance API, routing, user actions, service worker, extension/Electron renderer hooks, and browser context propagation. |
| Node.js / server       | First-party automatic collectors in `@loggerjs/node`    | 16    | Process crashes, diagnostics channels, HTTP frameworks, outgoing clients, CLI/serverless lifecycle, queues, and database clients.                                                     |
| Runtime-neutral / core | Integration API only in `@loggerjs/core`                | —     | The core package defines the integration contract and loop-prevention helpers, but platform capture lives in the browser and Node.js packages.                                        |

Custom integrations should feature-detect their platform surface and no-op when the surface is unavailable.

## Stability Levels

Integration stability describes the public setup/options contract and teardown
behavior. It does not mean the underlying platform emits every signal in every
runtime, browser version, framework version, or deployment mode.

| Level | Meaning |
| --- | --- |
| Stable | Intended for v1-compatible application use. Option names, setup/teardown behavior, and high-level captured fields are protected. |
| Compatible | Public and tested, but exact field shape or framework/runtime edge handling may still be refined before v1. |
| Runtime-dependent | Public API is stable, but the signal itself depends on platform support, browser policy, framework hooks, or deployment lifecycle behavior. |

| Integration | Stability | Why |
| --- | --- | --- |
| `captureConsoleIntegration()` | Stable | Core browser capture primitive with loop prevention and teardown coverage. |
| `captureBrowserErrorsIntegration()` | Stable | Standard browser error and rejection capture; CSP details vary by browser. |
| `captureFetchIntegration()` / `captureXHRIntegration()` | Stable | Request/response capture contract is stable with explicit sanitization hooks. |
| `pageLifecycleIntegration()` | Runtime-dependent | API is stable, but pagehide/visibility timing is browser-controlled and best effort. |
| `captureWebVitalsIntegration()` | Runtime-dependent | Depends on PerformanceObserver and browser metric support. |
| `capturePerformanceIntegration()` | Runtime-dependent | Entry availability differs by browser, permission policy, and page lifecycle. |
| `captureReportingIntegration()` | Runtime-dependent | ReportingObserver and report types vary across browsers. |
| `captureRouterIntegration()` | Stable | History/hash capture is stable for generic browser routing. |
| Framework router adapters | Compatible | Public adapters are tested, but framework-specific hook shapes may evolve. |
| `captureFrameworkErrorsIntegration()` | Compatible | Public helper API is stable; framework error hook payloads remain framework-owned. |
| `captureUserActionsIntegration()` | Compatible | Privacy-first defaults are stable; element metadata heuristics may be tuned. |
| `captureWebSocketIntegration()` | Compatible | Constructor patching and event capture are public; sampled message details may evolve. |
| `captureServiceWorkerIntegration()` | Runtime-dependent | Depends on service worker availability and lifecycle messages. |
| `captureRuntimeHostIntegration()` | Runtime-dependent | Extension and Electron surfaces are host-specific and intentionally opt-in by channel. |
| `browserContextPropagationIntegration()` | Stable | Ambient context binding contract is stable. |
| `captureProcessIntegration()` | Stable | Node crash/warning/exit capture and bounded flush behavior are production commitments. |
| `diagnosticsChannelIntegration()` | Runtime-dependent | Node channel names and payloads come from Node and instrumented libraries. |
| HTTP framework integrations | Compatible | Express/Fastify/Koa/Nest/Hapi adapters are public; framework lifecycle details may be tuned. |
| `nodeFetchIntegration()` / `nodeHttpClientIntegration()` | Compatible | Outgoing HTTP capture is public; Node/undici/http edge details may evolve. |
| `captureCliIntegration()` / `serverlessIntegration()` | Compatible | Lifecycle contract is public; platform-specific invocation metadata may be refined. |
| `queueIntegration()` / `bullMqIntegration()` | Compatible | Generic and BullMQ operation capture is public; queue payload metadata is intentionally configurable. |
| `databaseIntegration()` / `prismaIntegration()` / `redisIntegration()` | Compatible | Data-client method wrapping is public; statement/command extraction heuristics may evolve. |

## Import Boundaries

Root package imports are convenience presets. Public integration subpaths are
documented so users can choose narrower bundles and so new built-in integrations
cannot silently expand the surface without matching docs.

| Runtime | Public integration subpaths |
| --- | --- |
| Browser | `@loggerjs/browser/integration-console`, `@loggerjs/browser/integration-context`, `@loggerjs/browser/integration-errors`, `@loggerjs/browser/integration-fetch`, `@loggerjs/browser/integration-xhr`, `@loggerjs/browser/integration-framework-errors`, `@loggerjs/browser/integration-framework-routers`, `@loggerjs/browser/integration-reporting`, `@loggerjs/browser/integration-router`, `@loggerjs/browser/integration-runtime-host`, `@loggerjs/browser/integration-service-worker`, `@loggerjs/browser/integration-user-actions`, `@loggerjs/browser/integration-websocket`, `@loggerjs/browser/integration-web-vitals`, `@loggerjs/browser/integration-performance`, `@loggerjs/browser/integration-page-lifecycle` |
| Node.js | `@loggerjs/node/integration-process`, `@loggerjs/node/integration-cli`, `@loggerjs/node/integration-koa`, `@loggerjs/node/integration-nest`, `@loggerjs/node/integration-hapi`, `@loggerjs/node/integration-prisma`, `@loggerjs/node/integration-redis`, `@loggerjs/node/integration-queue`, `@loggerjs/node/integration-bullmq`, `@loggerjs/node/integration-serverless`, `@loggerjs/node/integration-database`, `@loggerjs/node/integration-express`, `@loggerjs/node/integration-fastify`, `@loggerjs/node/integration-fetch`, `@loggerjs/node/integration-http-client`, `@loggerjs/node/integration-diagnostics` |

`pnpm verify:component-docs` fails when a public integration subpath is exported
without being listed here. New entries should also update the stability table
above and the runtime validation notes for that integration family.

## Browser / Frontend (`@loggerjs/browser`)

| Integration                                                                                                   | Captures                                                                               | Notes                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `captureConsoleIntegration()`                                                                                 | `console.debug/info/log/warn/error/trace` calls                                        | Level allowlist (`levels`), rate limit (default 100/s). Patched methods restore on teardown; the console transport writes through unpatched methods, so no loops. |
| `captureBrowserErrorsIntegration()`                                                                           | `window.onerror` script/resource errors, `unhandledrejection`, optional CSP violations | Deduplicates rapid identical script errors.                                                                                                                       |
| `captureFetchIntegration()`                                                                                   | Failed (status ≥ `minStatus`, default 400) and sampled successful `fetch` calls        | Header allowlists, URL sanitizer. Errors re-throw to the app after capture.                                                                                       |
| `captureXHRIntegration()`                                                                                     | `XMLHttpRequest` lifecycle with status and duration                                    | Same sanitization options as fetch.                                                                                                                               |
| `pageLifecycleIntegration()`                                                                                  | Flushes transports on `pagehide` / `visibilitychange`                                  | Coalesces rapid flushes; pair with the HTTP transport's beacon mode.                                                                                              |
| `captureWebVitalsIntegration()`                                                                               | CLS, FCP, INP, LCP, TTFB                                                               | Emits incremental and final values via PerformanceObserver.                                                                                                       |
| `capturePerformanceIntegration()`                                                                             | navigation, resource, longtask, measure, mark entries                                  | Deduplicated, capped by `maxEntries`.                                                                                                                             |
| `captureUserActionsIntegration()`                                                                             | clicks, inputs, submits                                                                | Per-element throttling; text/value capture is off by default.                                                                                                     |
| `captureRouterIntegration()`                                                                                  | route changes (`pushState`/`replaceState`/`popstate`/`hashchange`)                     | Optional state normalization.                                                                                                                                     |
| `captureReportingIntegration()`                                                                               | ReportingObserver reports (CSP, deprecation, intervention, crash)                      | Drains pending reports on teardown.                                                                                                                               |
| `captureServiceWorkerIntegration()`                                                                           | service worker lifecycle, messages, message errors                                     | Message data capture off by default.                                                                                                                              |
| `captureWebSocketIntegration()`                                                                               | WebSocket connect/open/close/error and sampled messages                                | Wraps the constructor; sockets created before setup are not tracked.                                                                                              |
| `captureFrameworkErrorsIntegration()`                                                                         | React/Vue/Solid/Svelte error hooks                                                     | Exposes `reactComponentDidCatch()`, `vueErrorHandler()`, etc.; buffers errors raised before the logger exists (`maxPending`).                                     |
| `captureRuntimeHostIntegration()`                                                                             | browser-extension messages, Electron IPC on configured channels                        | Conservative default: no channels monitored.                                                                                                                      |
| `browserContextPropagationIntegration()`                                                                      | session/request/action and trace context                                               | Adds ambient context providers for traceparent, baggage, session id, request id, and recent user action.                                                          |
| `nextRouterIntegration()` / `reactRouterIntegration()` / `vueRouterIntegration()` / `nuxtRouterIntegration()` | framework router transitions                                                           | Thin adapters over common router APIs; sanitize URLs before logging.                                                                                              |

## Node.js / Server (`@loggerjs/node`)

| Integration                                                              | Captures                                                              | Notes                                                                                                                                            |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `captureProcessIntegration()`                                            | `uncaughtException` (fatal), `unhandledRejection`, warnings, exit     | With `exitOnUncaught`, captures a fatal record, calls `flushSync()`, waits up to `flushTimeoutMs` for async `flush()`, then exits with code `1`. |
| `diagnosticsChannelIntegration()`                                        | Node `diagnostics_channel` messages (http, undici, custom channels)   | Message payload capture off by default.                                                                                                          |
| `expressIntegration(logger)`                                             | request completion with status, route, duration, request id           | Returns an Express middleware; optional `withContext` binding per request.                                                                       |
| `fastifyIntegration(logger)`                                             | request lifecycle via onRequest/onError/onResponse hooks              | Returns a Fastify plugin; state keyed in a WeakMap.                                                                                              |
| `nodeFetchIntegration()`                                                 | outgoing `fetch` calls with status and duration                       | Errors re-throw after capture.                                                                                                                   |
| `nodeHttpClientIntegration()`                                            | `http.request` / `http.get` calls                                     |                                                                                                                                                  |
| `captureCliIntegration()`                                                | CLI start, exit code, SIGINT/SIGTERM                                  | Sanitizes argv for token/password/secret patterns.                                                                                               |
| `serverlessIntegration(logger, handler)`                                 | wraps a serverless handler: invocation, duration, cold start, errors  | Supports promise, callback, and sync handlers.                                                                                                   |
| `queueIntegration()`                                                     | queue client operations (publish/consume/ack/nack) with duration      | Patches the methods you list per client.                                                                                                         |
| `databaseIntegration()`                                                  | database client calls (query/execute/...) with statement and duration | Statement extracted from the first string arg or `.sql`/`.text`/`.query` properties.                                                             |
| `koaIntegration()` / `nestMiddlewareIntegration()` / `hapiIntegration()` | framework request lifecycle                                           | Thin adapters for Koa, Nest middleware, and Hapi request hooks.                                                                                  |
| `prismaIntegration()` / `redisIntegration()`                             | data client operations                                                | Captures selected query/command methods, duration, errors, and optional payload metadata.                                                        |
| `bullMqIntegration()`                                                    | BullMQ producer/worker operations                                     | Captures `add`, `addBulk`, and `process` with optional job payload metadata.                                                                     |

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
- Setup is idempotent per integration _instance_; creating two instances patches twice. Export a factory and document it.
- Degrade gracefully: feature-detect the platform surface and no-op when it is missing.
- Capture raw structured data and let processors redact; do not pre-format messages.
