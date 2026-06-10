# @loggerjs/browser

Browser transports and integrations for automatic client-side collection.

```ts
import {
  browserHttpTransport,
  captureBrowserErrorsIntegration,
  captureConsoleIntegration,
  captureFetchIntegration,
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
  ],
  integrations: [
    captureConsoleIntegration({ levels: ["warn", "error"] }),
    captureBrowserErrorsIntegration(),
    captureFetchIntegration(),
    pageLifecycleIntegration(),
  ],
});

logger.info("page loaded");
```

Use `memoryBrowserHttpOfflineQueue()` for short-lived in-memory retry buffers, or
`indexedDbBrowserHttpOfflineQueue()` when payloads must survive page reloads.

Subpaths expose `transport-http`, `offline-indexeddb`, `integration-console`, `integration-errors`, `integration-fetch`, `integration-xhr`, and `integration-page-lifecycle`.
