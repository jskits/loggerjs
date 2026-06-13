# @loggerjs/browser

> Browser transports, offline persistence, and 19 automatic integrations — re-exports all of `@loggerjs/core`.

[![npm](https://img.shields.io/npm/v/@loggerjs/browser.svg)](https://www.npmjs.com/package/@loggerjs/browser)
[![license](https://img.shields.io/npm/l/@loggerjs/browser)](../../LICENSE)

The browser platform package for [LoggerJS](../../README.md). It re-exports the entire `@loggerjs/core` API and adds HTTP / IndexedDB / WebSocket / service-worker / broadcast-channel transports, offline queues with replay, ZIP export, and a broad suite of integrations that turn console calls, errors, network failures, Web Vitals, routing, and lifecycle events into structured logs — all opt-in.

## Install

```bash
npm install @loggerjs/browser @loggerjs/processors
```

## Usage

```ts
import {
  browserHttpTransport,
  captureBrowserErrorsIntegration,
  captureConsoleIntegration,
  captureFetchIntegration,
  captureWebVitalsIntegration,
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
    captureWebVitalsIntegration(),
    pageLifecycleIntegration(),
  ],
});

logger.info("page loaded");
```

Logs batch over HTTP, queue while offline, replay with backoff when the network returns, and attempt a last-chance best-effort `sendBeacon` flush when the tab closes.

## Transports

| Transport | Delivers to |
| --- | --- |
| `browserHttpTransport` | your collector — batching, offline queue, online replay with backoff, `sendBeacon` on page hide |
| `indexedDbTransport` | a local, queryable IndexedDB store (TTL, pruning, optional Storage Buckets and durability hints) |
| `browserWebSocketTransport` | a WebSocket (codec-encoded batches, queues while closed) |
| `browserServiceWorkerTransport` | a service worker for centralized delivery; `ready()` waits for `serviceWorker.ready` with `target: "ready"` |
| `browserBroadcastChannelTransport` | other tabs via `BroadcastChannel` |
| `offlineFirstTransport` | a local store first, then forwards online |

### Offline queues & export

- `memoryBrowserHttpOfflineQueue()` — short-lived in-memory retry buffer.
- `indexedDbBrowserHttpOfflineQueue()` — survives page reloads.
- `exportLogsToZip()` + `downloadBlob()` — export a persisted store as a zip containing `logs.ndjson` and `manifest.json`.
- Call the `indexedDbTransport()` instance's `stats()` to read flush, prune, query, drop, and buffer-depth counters.

Browser delivery has runtime loss windows: tab close can cut off async work,
`sendBeacon` is size- and user-agent-limited, service worker delivery depends on
activation and lifetime, and IndexedDB persistence depends on quota and browser
storage policy. Use an IndexedDB offline queue when reload survival matters.

## Integrations (19)

| Group | Integrations |
| --- | --- |
| **Console & errors** | `captureConsoleIntegration`, `captureBrowserErrorsIntegration`, `captureFrameworkErrorsIntegration`, `captureReportingIntegration` |
| **Network** | `captureFetchIntegration`, `captureXHRIntegration`, `captureWebSocketIntegration` |
| **Performance** | `captureWebVitalsIntegration`, `capturePerformanceIntegration` |
| **Navigation** | `captureRouterIntegration`, `nextRouterIntegration`, `reactRouterIntegration`, `vueRouterIntegration`, `nuxtRouterIntegration` |
| **Lifecycle & context** | `pageLifecycleIntegration`, `captureUserActionsIntegration`, `captureServiceWorkerIntegration`, `captureRuntimeHostIntegration`, `browserContextPropagationIntegration` |

Integrations patch through an unpatched-original registry and a re-entrancy guard, so the console transport never loops back through console capture. Framework error hooks expose `reactComponentDidCatch()`, `vueErrorHandler()`, etc.:

```ts
const frameworkErrors = captureFrameworkErrorsIntegration({ framework: "react" });
// In a React ErrorBoundary:
// componentDidCatch(error, info) { frameworkErrors.reactComponentDidCatch(error, info); }
```

## Subpath exports

Transports — `transport-http` · `transport-indexeddb` · `transport-websocket` · `transport-service-worker` · `transport-broadcast-channel` · `offline-first-transport` · `offline-indexeddb` · `export-zip` · `payload-transforms`

Integrations — `integration-console` · `integration-errors` · `integration-framework-errors` · `integration-reporting` · `integration-fetch` · `integration-xhr` · `integration-websocket` · `integration-web-vitals` · `integration-performance` · `integration-router` · `integration-framework-routers` · `integration-page-lifecycle` · `integration-user-actions` · `integration-service-worker` · `integration-runtime-host` · `integration-context`

## Documentation

- [Transports](../../docs/TRANSPORTS.md) · [Integrations](../../docs/INTEGRATIONS.md) · [Operations](../../docs/OPERATIONS.md)
- [Getting Started](../../docs/GETTING-STARTED.md) · [LoggerJS root README](../../README.md)

## License

[MIT](../../LICENSE) © JS Kits
