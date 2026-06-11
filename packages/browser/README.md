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
  downloadBlob,
  exportLogsToZip,
  indexedDbBrowserHttpOfflineQueue,
  indexedDbTransport,
  memoryBrowserHttpOfflineQueue,
  pageLifecycleIntegration,
} from "@loggerjs/browser";

const frameworkErrors = captureFrameworkErrorsIntegration({ framework: "react" });
const localStore = indexedDbTransport({
  durability: "relaxed",
  maxEntries: 50_000,
  storageBucketName: "loggerjs-logs",
  storageBucketDurability: "relaxed",
  ttlMs: 7 * 24 * 60 * 60 * 1000,
});

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
    localStore,
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

const zip = await exportLogsToZip(localStore, { source: "indexeddb" });
downloadBlob(zip, "loggerjs-logs.zip");

// React ErrorBoundary: componentDidCatch(error, info) {
//   frameworkErrors.reactComponentDidCatch(error, info);
// }
```

Use `memoryBrowserHttpOfflineQueue()` for short-lived in-memory retry buffers, or
`indexedDbBrowserHttpOfflineQueue()` when payloads must survive page reloads.
Use `indexedDbTransport()` when the browser should keep a local, queryable log store.
It can opt into IndexedDB transaction durability hints and Chrome Storage Buckets
for better isolation when the browser supports them. For high-throughput local
capture on modern Chrome, prefer `durability: "relaxed"` with a dedicated
`storageBucketName` and `storageBucketDurability: "relaxed"`; unsupported browsers
fall back to the regular IndexedDB instance. Call `localStore.stats()` to read
flush, prune, query, drop, and buffer-depth counters for observability.
Use `exportLogsToZip()` and `downloadBlob()` to export persisted browser logs as a
standard zip file containing `logs.ndjson` and `manifest.json`.

Subpaths expose `transport-http`, `transport-broadcast-channel`, `transport-service-worker`, `transport-websocket`, `transport-indexeddb`, `offline-indexeddb`, `export-zip`, `integration-console`, `integration-errors`, `integration-fetch`, `integration-xhr`, `integration-framework-errors`, `integration-reporting`, `integration-router`, `integration-runtime-host`, `integration-service-worker`, `integration-user-actions`, `integration-websocket`, `integration-web-vitals`, `integration-performance`, and `integration-page-lifecycle`.
