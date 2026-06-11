# @loggerjs/browser

Browser transports and integrations for automatic client-side collection.

```ts
import {
  browserHttpTransport,
  browserBroadcastChannelTransport,
  browserServiceWorkerTransport,
  browserWebSocketTransport,
  captureBrowserErrorsIntegration,
  captureConsoleIntegration,
  captureFetchIntegration,
  captureFrameworkErrorsIntegration,
  capturePerformanceIntegration,
  captureReportingIntegration,
  captureRouterIntegration,
  captureRuntimeHostIntegration,
  captureServiceWorkerIntegration,
  captureUserActionsIntegration,
  captureWebSocketIntegration,
  captureWebVitalsIntegration,
  createLogger,
  indexedDbBrowserHttpOfflineQueue,
  indexedDbTransport,
  memoryBrowserHttpOfflineQueue,
  pageLifecycleIntegration,
} from "@loggerjs/browser";

const frameworkErrors = captureFrameworkErrorsIntegration({ framework: "react" });

const logger = createLogger({
  name: "web",
  transports: [
    browserHttpTransport({
      url: "/api/logs",
      offlineQueue: indexedDbBrowserHttpOfflineQueue({ maxEntries: 500 }),
      useBeaconOnPageHide: true,
    }),
    browserBroadcastChannelTransport({ channelName: "loggerjs" }),
    browserServiceWorkerTransport(),
    browserWebSocketTransport({ url: "wss://example.com/logs" }),
    indexedDbTransport({ maxEntries: 50_000, ttlMs: 7 * 24 * 60 * 60 * 1000 }),
  ],
  integrations: [
    captureConsoleIntegration({ levels: ["warn", "error"] }),
    captureBrowserErrorsIntegration(),
    captureFetchIntegration(),
    frameworkErrors,
    captureReportingIntegration(),
    captureRouterIntegration(),
    captureRuntimeHostIntegration({ electronChannels: ["main:error"] }),
    captureServiceWorkerIntegration(),
    captureUserActionsIntegration(),
    captureWebSocketIntegration(),
    captureWebVitalsIntegration(),
    capturePerformanceIntegration({ entryTypes: ["navigation", "resource", "longtask"] }),
    pageLifecycleIntegration(),
  ],
});

logger.info("page loaded");

// React ErrorBoundary: componentDidCatch(error, info) {
//   frameworkErrors.reactComponentDidCatch(error, info);
// }
```

Use `memoryBrowserHttpOfflineQueue()` for short-lived in-memory retry buffers, or
`indexedDbBrowserHttpOfflineQueue()` when payloads must survive page reloads.
Use `indexedDbTransport()` when the browser should keep a local, queryable log store.

Subpaths expose `transport-http`, `transport-broadcast-channel`, `transport-service-worker`, `transport-websocket`, `transport-indexeddb`, `offline-indexeddb`, `integration-console`, `integration-errors`, `integration-fetch`, `integration-xhr`, `integration-framework-errors`, `integration-reporting`, `integration-router`, `integration-runtime-host`, `integration-service-worker`, `integration-user-actions`, `integration-websocket`, `integration-web-vitals`, `integration-performance`, and `integration-page-lifecycle`.
