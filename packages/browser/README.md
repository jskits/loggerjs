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
  captureUserActionsIntegration,
  captureWebSocketIntegration,
  captureWebVitalsIntegration,
  createLogger,
  indexedDbBrowserHttpOfflineQueue,
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
  ],
  integrations: [
    captureConsoleIntegration({ levels: ["warn", "error"] }),
    captureBrowserErrorsIntegration(),
    captureFetchIntegration(),
    frameworkErrors,
    captureReportingIntegration(),
    captureRouterIntegration(),
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

Subpaths expose `transport-http`, `transport-broadcast-channel`, `transport-service-worker`, `transport-websocket`, `offline-indexeddb`, `integration-console`, `integration-errors`, `integration-fetch`, `integration-xhr`, `integration-framework-errors`, `integration-reporting`, `integration-router`, `integration-user-actions`, `integration-websocket`, `integration-web-vitals`, `integration-performance`, and `integration-page-lifecycle`.
