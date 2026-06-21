# Production Recipes

These recipes are starting points for production deployments. They intentionally
show queue bounds, privacy processors, shutdown behavior, and where credentials
belong. Tune names, tags, and endpoint URLs to your application.

## Browser to HTTP With IndexedDB Offline Replay

Use this when browser logs should survive network drops and normal reloads. The
browser still cannot guarantee delivery during process kill, storage eviction,
private browsing restrictions, or quota exhaustion.

```ts
import {
  browserHttpTransport,
  captureBrowserErrorsIntegration,
  captureConsoleIntegration,
  captureFetchIntegration,
  captureWebVitalsIntegration,
  createLogger,
  indexedDbBrowserHttpOfflineQueue,
  pageLifecycleIntegration,
} from "@loggerjs/browser";
import { privacyGuardProcessor, redactProcessor } from "@loggerjs/processors";

const offlineQueue = indexedDbBrowserHttpOfflineQueue({
  dbName: "checkout-web-http-offline",
  storeName: "http-offline",
  maxEntries: 5000,
  dropPolicy: "drop-oldest",
});

export const logger = createLogger({
  category: ["web"],
  level: "info",
  tags: {
    service: "checkout-web",
    env: "production",
    runtime: "browser",
  },
  processors: [
    redactProcessor({
      keys: ["password", "token", "authorization", "cookie", /secret/i],
    }),
    privacyGuardProcessor({
      maxStringLength: 8192,
    }),
  ],
  transports: [
    browserHttpTransport({
      name: "browser-http",
      url: "/api/logs",
      maxBatchSize: 50,
      flushIntervalMs: 2000,
      maxQueueSize: 2000,
      dropPolicy: "drop-oldest",
      offlineQueue,
      offlineReplayMaxRetries: 3,
      offlineReplayBaseDelayMs: 250,
      offlineReplayMaxDelayMs: 5000,
      useBeaconOnPageHide: true,
      beaconMaxBytes: 60 * 1024,
    }),
  ],
  integrations: [
    captureConsoleIntegration({
      levels: ["warn", "error"],
      captureArguments: false,
      maxCapturesPerSecond: 50,
    }),
    captureBrowserErrorsIntegration({
      captureSecurityPolicyViolation: true,
    }),
    captureFetchIntegration({
      minStatus: 400,
      captureRequestHeaders: ["content-type", "x-request-id"],
      captureResponseHeaders: ["content-type", "x-request-id"],
      sanitizeUrl: (url) => {
        const parsed = new URL(url, location.origin);
        parsed.search = "";
        return parsed.toString();
      },
    }),
    captureWebVitalsIntegration({ flushOnHidden: true }),
    pageLifecycleIntegration(),
  ],
});
```

Production notes:

- `/api/logs` should be your own collector endpoint. Do not put vendor API keys
  in the browser bundle.
- Keep fetch/XHR header capture allowlisted. Do not capture cookies,
  authorization headers, request bodies, or form values by default.
- Alert on logger meta counters such as `transport.dropped.*` and offline queue
  depth when your app exposes them.
- Keep the HTTP offline queue `dbName` separate from any queryable support-log
  store. The two helpers use independent IndexedDB schemas and version lifecycles.

## Browser Support Export With Session-Aware IndexedDB

Use this when support or QA needs a local log bundle that survives reloads and
can be exported by session. The local store is separate from the HTTP delivery
queue: IndexedDB is the queryable source of truth, while `localStorageSpill`
only protects the small tail that has not finished its async IndexedDB write
when the user refreshes or closes the page.

```ts
import { createLogger } from "@loggerjs/core";
import { indexedDbTransport } from "@loggerjs/browser/transport-indexeddb";
import { downloadBlob, exportLogsToZip } from "@loggerjs/browser/export-zip";
import { privacyGuardProcessor, redactProcessor } from "@loggerjs/processors";

const supportStore = indexedDbTransport({
  name: "support-indexeddb",
  dbName: "checkout-web-support-logs",
  storeName: "support-logs",
  maxEntries: 20_000,
  maxBytes: 25 * 1024 * 1024,
  ttlMs: 7 * 24 * 60 * 60 * 1000,
  batchSize: 50,
  flushIntervalMs: 1000,
  durability: "relaxed",
  localStorageSpill: {
    namespace: "checkout-support-logs",
    maxEntries: 200,
    maxBytes: 512 * 1024,
    minLevel: "info",
  },
});

export const supportLogger = createLogger({
  category: ["web"],
  level: "info",
  processors: [
    redactProcessor({
      keys: ["password", "token", "authorization", "cookie", /secret/i],
    }),
    privacyGuardProcessor({ maxStringLength: 8192 }),
  ],
  transports: [supportStore],
});

export async function downloadSupportLogZip() {
  await supportLogger.flush();
  const zip = await exportLogsToZip(supportStore, {
    groupBySession: true,
    includeRecent: { maxEvents: 500 },
    query: {
      from: Date.now() - 7 * 24 * 60 * 60 * 1000,
      order: "asc",
    },
    source: "indexeddb",
  });
  downloadBlob(zip, `checkout-logs-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`);
}
```

Production notes:

- Keep privacy processors before the IndexedDB transport. Anything persisted
  locally can be exported by a user or support flow.
- `indexedDbTransport()` creates a page-session id by default and stores it in
  both the IndexedDB entry metadata and `event.context.sessionId` when absent.
  If your app already owns session ids, pass `session: { id, getId, contextKey }`.
- `localStorageSpill` is bounded and best effort. It improves normal reload and
  close behavior but cannot protect against process kill, crash, disabled
  storage, quota exhaustion, or storage eviction.

## Node to Stdout Plus OTLP

Use stdout as the local, platform-native sink and OTLP as the remote
observability path. Stdout remains useful for container runtimes and fatal
events even if the OTLP endpoint is degraded.

```ts
import * as otelApi from "@opentelemetry/api";
import {
  captureProcessIntegration,
  createLogger,
  installAsyncLocalStorageContext,
  stdoutTransport,
} from "@loggerjs/node";
import { openTelemetryTraceProcessor, otlpHttpTransport } from "@loggerjs/otel";
import { redactProcessor } from "@loggerjs/processors";

installAsyncLocalStorageContext();

export const logger = createLogger({
  category: ["api"],
  level: "info",
  tags: {
    service: "checkout-api",
    env: process.env.NODE_ENV ?? "production",
    runtime: "node",
  },
  processors: [
    openTelemetryTraceProcessor({ api: otelApi }),
    redactProcessor({
      keys: ["password", "token", "authorization", "cookie", /secret/i],
    }),
  ],
  transports: [
    stdoutTransport({
      name: "stdout",
      minLength: 4096,
    }),
    otlpHttpTransport({
      name: "otlp",
      url: process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ?? "http://localhost:4318/v1/logs",
      headers: process.env.OTEL_EXPORTER_OTLP_AUTHORIZATION
        ? { authorization: process.env.OTEL_EXPORTER_OTLP_AUTHORIZATION }
        : undefined,
      resource: {
        "service.name": "checkout-api",
        "deployment.environment": process.env.NODE_ENV ?? "production",
      },
      maxRecords: 100,
      maxWaitMs: 2000,
      maxQueueSize: 5000,
      maxRetries: 3,
      circuitBreakerFailureThreshold: 5,
      circuitBreakerResetMs: 30000,
    }),
  ],
  integrations: [
    captureProcessIntegration({
      exitOnUncaught: true,
      flushTimeoutMs: 500,
    }),
  ],
});

export async function closeLogger() {
  await logger.close();
}
```

Production notes:

- Keep at least one local sink (`stdoutTransport()` or `fileTransport()`) for
  fatal process paths. Remote OTLP should not be the only crash-path sink.
- Install `@opentelemetry/api` and initialize tracing before constructing the
  logger when you want active span correlation.
- Use your deployment platform's graceful shutdown hook to call `logger.close()`.

## Full Stack to Loki and Datadog

Use this when browser and server logs should land in the same vendor backends.
The browser sends logs to your own collector; the server owns Loki and Datadog
credentials and forwards both server-side events and accepted browser batches.

```ts
import {
  batchTransport,
  createLogger,
  recordToEvent,
  type LogEvent,
  type Transport,
  type TransportContext,
} from "@loggerjs/core";
import { datadogLogsTransport } from "@loggerjs/datadog";
import { lokiTransport } from "@loggerjs/loki";
import { redactProcessor } from "@loggerjs/processors";

const service = "checkout";
const env = process.env.NODE_ENV ?? "production";

function reliableVendorTransport(transport: Transport): Transport {
  return batchTransport(transport, {
    maxRecords: 100,
    maxWaitMs: 2000,
    maxQueueSize: 10000,
    dropPolicy: "drop-oldest",
    maxRetries: 3,
    retryBaseDelayMs: 250,
    retryMaxDelayMs: 5000,
    circuitBreakerFailureThreshold: 5,
    circuitBreakerResetMs: 30000,
  });
}

const vendorTransports = [
  reliableVendorTransport(
    lokiTransport({
      url: process.env.LOKI_URL ?? "http://localhost:3100/loki/api/v1/push",
      tenantId: process.env.LOKI_TENANT_ID,
      labels: { service, env },
      labelTags: ["runtime"],
      structuredMetadata: true,
    }),
  ),
  reliableVendorTransport(
    datadogLogsTransport({
      apiKey: process.env.DD_API_KEY,
      site: process.env.DD_SITE ?? "datadoghq.com",
      service,
      source: "loggerjs",
      tags: { env },
      eventTagKeys: ["runtime"],
    }),
  ),
];

export const serverLogger = createLogger({
  category: ["api"],
  level: "info",
  tags: { service, env, runtime: "node" },
  processors: [
    redactProcessor({
      keys: ["password", "token", "authorization", "cookie", /secret/i],
    }),
  ],
  transports: vendorTransports,
});

const collectorContext: TransportContext = {
  loggerName: "browser-log-collector",
  now: () => Date.now(),
  toEvent: recordToEvent,
  reportInternalError(error, detail) {
    serverLogger.warn("browser log collector failed", { error, detail });
  },
};

export async function forwardBrowserLogs(events: LogEvent[]) {
  for (const transport of vendorTransports) {
    if (transport.logBatch) await transport.logBatch(events, collectorContext);
    else {
      for (const event of events) await transport.log?.(event, collectorContext);
    }
  }
}
```

Production notes:

- Validate and bound the `/api/logs` request body before calling
  `forwardBrowserLogs()`. Reject oversized batches early.
- Promote only low-cardinality fields to Loki labels and Datadog tags. Keep user
  ids, request ids, order ids, and URLs in structured metadata/data.
- Apply the same redaction policy in the browser and the server collector. Treat
  browser-submitted logs as untrusted input.
