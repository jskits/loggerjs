# Operations

This guide covers the parts of LoggerJS that most affect production behavior: privacy, browser buffering, crash paths, and remote delivery reliability.

## Privacy

Automatic integrations are opt-in. Enable only the capture surfaces your product needs.

Recommended defaults:

- Use `redactProcessor()` before any remote transport.
- Allowlist HTTP headers in fetch/XHR integrations. Do not ship cookies, authorization headers, or full request bodies by default.
- Sanitize URLs when query strings may contain tokens or user data.
- Keep console capture to `warn` and `error` unless debug collection is explicitly needed.
- Prefer stable tags such as `service`, `env`, and `runtime`; put high-cardinality values in event data, not tags.

Example:

```ts
import { captureFetchIntegration } from "@loggerjs/browser";
import { redactProcessor } from "@loggerjs/processors";

const processors = [redactProcessor({ keys: ["password", "token", /secret/i] })];
const integrations = [
  captureFetchIntegration({
    captureRequestHeaders: ["content-type", "x-request-id"],
    captureResponseHeaders: ["content-type", "x-request-id"],
    sanitizeUrl: (url) => new URL(url, location.origin).origin,
  }),
];
```

`redactProcessor()` masks by key, exact dot path, regex, or custom matcher. Paths
are relative to each redacted event field (`user.password`, not
`data.user.password`). Use `replacement` (or the Pino-compatible `censor` alias)
to mask values, and `remove: true` when the field should be omitted from the
event. LoggerJS does not compile redaction paths with `eval` or `new Function`;
wildcard-like regexes and deep traversal are safer than generated code but cost
more than exact keys and paths.

`privacyGuardProcessor()` is broader: it scans selected fields for built-in and
custom string patterns such as emails, bearer tokens, and card-like values. Use
it as a safety net, not as a replacement for capture allowlists.

## Browser Queue And Offline Replay

`browserHttpTransport()` batches records in memory and can persist failed payloads into an offline queue adapter. The built-in memory queue is intentionally small and dependency-free; applications that need reload survival should provide an IndexedDB-backed adapter with the same interface.

```ts
import { browserHttpTransport, memoryBrowserHttpOfflineQueue } from "@loggerjs/browser";

const transport = browserHttpTransport({
  url: "/api/logs",
  maxBatchSize: 50,
  maxQueueSize: 1000,
  offlineQueue: memoryBrowserHttpOfflineQueue({ maxEntries: 500 }),
  useBeaconOnPageHide: true,
  beaconMaxBytes: 60 * 1024,
});
```

When the browser fires `online`, the transport replays stored payloads with retry and backoff. Page lifecycle integration should be enabled when logs matter during tab close or navigation:

```ts
import { pageLifecycleIntegration } from "@loggerjs/browser";

const integrations = [pageLifecycleIntegration()];
```

Browser storage and shutdown behavior are still best effort. `sendBeacon` can be
size-limited or skipped during shutdown, in-memory queues disappear on reload,
and IndexedDB can be unavailable, full, evicted, or blocked by an upgrade. For
production browser delivery, combine:

- `browserHttpTransport()` for normal remote delivery.
- `indexedDbBrowserHttpOfflineQueue()` or `offlineFirstTransport()` for reload-surviving replay.
- `pageLifecycleIntegration()` and `useBeaconOnPageHide` for last-chance flush.
- Drop/queue metrics from logger meta so quota or backpressure is visible.

## Node Crash Path

For process-level failures, combine `captureProcessIntegration()` with a transport that can flush synchronously when needed.

```ts
import { captureProcessIntegration, fileTransport, stdoutTransport } from "@loggerjs/node";

const transports = [
  stdoutTransport(),
  fileTransport({ path: "./logs/app.ndjson" }),
];
const integrations = [captureProcessIntegration({ exitOnUncaught: true })];
```

Crash-path guidance:

- Keep at least one local transport for fatal process events.
- Prefer `flushSync()` for final synchronous shutdown when the transport supports it; use `await flush()` for normal drain-and-continue shutdowns.
- Use `fileTransport({ sync: true })` when every write must reach the filesystem before the log call returns.
- Use HTTP/OTLP remote transports for normal delivery, not as the only fatal-path sink.
- Keep processor work synchronous and bounded; crash handlers should not perform slow enrichment.

For `uncaughtException` with `exitOnUncaught: true`, the sequence is:

1. Capture a `fatal` record with `process.kind: "uncaughtException"`.
2. Call `flushSync()` on sync-capable transports.
3. Run a bounded async `flush()` race controlled by `flushTimeoutMs` (default `250` ms).
4. Exit with code `1`.

For signals with `exitOnSignal: true`, LoggerJS captures a fatal signal record,
uses the same sync-plus-bounded-async flush sequence, then exits with the signal
exit code when known (`SIGTERM` -> `143`, `SIGINT` -> `130`).

## Remote Transport Reliability

Batch-based transports support the same core reliability options:

```ts
{
  maxRecords: 100,
  maxBytes: 64 * 1024,
  maxWaitMs: 2000,
  concurrency: 2,
  maxRetries: 3,
  retryBaseDelayMs: 250,
  retryMaxDelayMs: 5000,
  circuitBreakerFailureThreshold: 5,
  circuitBreakerResetMs: 30000,
}
```

Use byte limits when payload size matters more than event count. Use `onDrop` to surface queue drops into your own metrics pipeline.

## Context And Trace Correlation

Use explicit child context for values known at construction time and ambient context for request-scoped values:

```ts
import { installAsyncLocalStorageContext } from "@loggerjs/node";
import { withContext } from "@loggerjs/core";

installAsyncLocalStorageContext();

await withContext({ requestId: "req_123" }, async () => {
  logger.info("request started");
});
```

Use `openTelemetryTraceProcessor()` to attach the active OpenTelemetry span context when an OpenTelemetry API object is available.
