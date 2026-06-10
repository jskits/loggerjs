# @loggerjs/browser

Browser transports and integrations for automatic client-side collection.

```ts
import {
  browserHttpTransport,
  browserBroadcastChannelTransport,
  captureBrowserErrorsIntegration,
  captureConsoleIntegration,
  captureFetchIntegration,
  captureWebVitalsIntegration,
  createLogger,
  indexedDbBrowserHttpOfflineQueue,
  memoryBrowserHttpOfflineQueue,
  pageLifecycleIntegration,
} from "@loggerjs/browser";

const logger = createLogger({
  name: "web",
  transports: [
    browserHttpTransport({
      url: "/api/logs",
      offlineQueue: indexedDbBrowserHttpOfflineQueue({ maxEntries: 500 }),
      useBeaconOnPageHide: true,
    }),
    browserBroadcastChannelTransport({ channelName: "loggerjs" }),
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

Use `memoryBrowserHttpOfflineQueue()` for short-lived in-memory retry buffers, or
`indexedDbBrowserHttpOfflineQueue()` when payloads must survive page reloads.

Subpaths expose `transport-http`, `transport-broadcast-channel`, `offline-indexeddb`, `integration-console`, `integration-errors`, `integration-fetch`, `integration-xhr`, `integration-web-vitals`, and `integration-page-lifecycle`.
