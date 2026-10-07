# Transports

A transport delivers log records or events to a destination. This page catalogs every built-in transport and shows how to write your own. Exact option types live in each package's TypeScript declarations and `api-reports/`.

For an auditable map from each transport to source files, public entries, and contract tests, see [TRANSPORT-CONTRACTS.md](TRANSPORT-CONTRACTS.md).

## Runtime Support

| Runtime | Transport support | Notes |
| --- | --- | --- |
| Core / runtime-neutral | `consoleTransport`, `memoryTransport`, `testTransport`, `batchTransport`, `retryTransport`, `fallbackTransport` | These do not require browser or Node.js-only APIs. Wrappers work around any transport available in the current runtime. |
| Pretty / developer UX | `prettyConsoleTransport`, `prettyStreamTransport`, `prettyStdoutTransport`, `prettyStderrTransport` | Browser DevTools and Node terminal display transports from `@loggerjs/pretty`. They are for human-readable output, not durable production delivery. |
| Browser / frontend | `browserHttpTransport`, IndexedDB queues/store, WebSocket, service worker, BroadcastChannel, offline-first replay | Uses browser APIs such as `fetch`, `sendBeacon`, `IndexedDB`, `navigator.onLine`, service workers, and BroadcastChannel with feature detection and fallbacks where available. |
| Node.js / server | `stdoutTransport`, `stderrTransport`, `fileTransport`, `rotatingFileTransport`, `nodeHttpTransport`, `nodeSyslogTransport`, `workerTransport` | Uses Node.js streams, filesystem, worker threads, network sockets, and Node fetch. |
| Vendor / observability | OTLP, Sentry, Datadog, Elastic, Loki, CloudWatch | HTTP wire transports run where their `fetch`/crypto/runtime requirements are present; SDK/provider adapters require the application-provided SDK object or provider. Vendor credentials are usually safer on servers or trusted workers. |
| Database / local app / backend | `databaseTransport`, `postgresTransport`, `sqliteTransport` | Driver-agnostic at the LoggerJS layer, but the application must provide database drivers; intended for Node.js, Electron, CLIs, or backend workers. |

## Stability Levels

Transport stability describes the public API promise, not an absolute delivery guarantee. Browser storage, process shutdown, network collectors, and vendor backends can still fail; the reliability table below is the delivery contract.

| Level | Meaning |
| --- | --- |
| Stable | Intended for v1-compatible application use. Option names and high-level semantics are protected by API reports, tests, and docs. |
| Compatible | Public and tested, but exact runtime behavior or message shape may still be tuned before v1. Use when the documented caveats fit your deployment. |
| Experimental | Public and tested, but not part of the v1 compatibility promise yet. Names, options, payload mapping, or batching guidance may change before v1. |
| Runtime-dependent | Public API is stable, but practical reliability depends heavily on browser, worker, storage, network, SDK, or database behavior outside LoggerJS. Validate in your target environment. |
| Test-only | Built for assertions and fixtures, not production delivery. |

| Transport | Stability | Why |
| --- | --- | --- |
| `consoleTransport()` | Stable | Runtime-neutral local sink with loop prevention for console capture. |
| `memoryTransport()` | Stable | Bounded in-memory diagnostics cache; intentionally non-durable. |
| `testTransport()` | Test-only | Assertion helper with wait/snapshot APIs. |
| `batchTransport()` / `retryTransport()` / `fallbackTransport()` | Stable | Core reliability wrappers used by first-party transports. |
| Pretty transports | Stable | Developer display API is stable; exact colors/layout remain presentation details. |
| `stdoutTransport()` / `stderrTransport()` / `fileTransport()` | Stable | Production local sinks with drain and crash-path behavior. |
| `rotatingFileTransport()` | Stable | Local size rotation; use one writer process per file. |
| `nodeHttpTransport()` | Stable | Self-wrapped batched HTTP delivery with shared reliability options. |
| `otlpHttpTransport()` | Experimental | OTLP mapping is public and tested, but observability adapter packages are not frozen before v1. |
| `nodeSyslogTransport()` | Compatible | Wire formatting is tested, but the transport is outside the v1 kernel until more deployments validate it; UDP/TCP reliability follows syslog transport semantics. |
| `workerTransport()` | Compatible | Message protocol is public, but ready/ack/fallback lifecycle tuning may evolve. |
| `browserHttpTransport()` | Stable | Primary browser remote transport; pagehide beacon remains best effort. |
| `memoryBrowserHttpOfflineQueue()` | Stable | Stable API for temporary offline periods; not reload-durable. |
| `indexedDbBrowserHttpOfflineQueue()` / `indexedDbTransport()` / `offlineFirstTransport()` | Runtime-dependent | Stable API, but persistence depends on browser IndexedDB, quota, eviction, private mode, and storage policy. |
| `browserWebSocketTransport()` | Compatible | Useful for live/debug channels; reconnection and final durability are caller-owned. |
| `browserServiceWorkerTransport()` | Runtime-dependent | API is public, but delivery depends on service worker registration, activation, and lifetime. |
| `browserBroadcastChannelTransport()` | Compatible | Same-origin tab fan-out is intentionally lossy and receiver-dependent. |
| Datadog / Elastic / Loki / CloudWatch transports | Experimental | Wire payloads are tested, but vendor packages are not frozen before v1; production durability requires batching/retry around raw transports. |
| `sentryTransport()` / `openTelemetryLogBridgeTransport()` | Experimental | Adapter contracts are public and tested, but SDK/provider mapping may still change before v1. |
| `databaseTransport()` / `sqliteTransport()` / `postgresTransport()` | Experimental | Adapter APIs are public and tested, but driver transaction and schema expectations need more design-partner validation before v1. |

## Import Boundaries

Root package imports are convenience presets. Public transport subpaths are documented so users can choose narrower bundles and so new built-in transports cannot silently expand the surface without matching docs.

| Runtime | Public transport subpaths |
| --- | --- |
| Core | `@loggerjs/core/transport-console`, `@loggerjs/core/transport-batch`, `@loggerjs/core/transport-reliability`, `@loggerjs/core/transport-test` |
| Browser | `@loggerjs/browser/transport-http`, `@loggerjs/browser/transport-broadcast-channel`, `@loggerjs/browser/transport-service-worker`, `@loggerjs/browser/transport-websocket`, `@loggerjs/browser/transport-indexeddb`, `@loggerjs/browser/offline-first-transport` |
| Node.js | `@loggerjs/node/transport-http`, `@loggerjs/node/transport-file`, `@loggerjs/node/transport-rotating-file`, `@loggerjs/node/transport-stdout`, `@loggerjs/node/transport-syslog`, `@loggerjs/node/transport-worker` |
| Pretty | `@loggerjs/pretty/transport-console`, `@loggerjs/pretty/transport-stream` |
| Observability and data | `@loggerjs/otel/transport-http`, `@loggerjs/sentry/transport`, `@loggerjs/datadog/transport`, `@loggerjs/elastic/transport`, `@loggerjs/loki/transport`, `@loggerjs/cloudwatch/transport`, `@loggerjs/database/transport` |

`pnpm verify:component-docs` fails when a public transport subpath is exported without being listed here. New entries should also update the stability and reliability tables above.

## Reliability Posture

Transports are composable by default. Some transports include batching or durable local storage internally; raw vendor wire transports do not retry unless you wrap them. Treat this table as the production delivery contract:

| Transport or wrapper | Default posture | Production note |
| --- | --- | --- |
| `consoleTransport()` | immediate local write | Human/dev output; no retry or durability beyond the console target. |
| `prettyConsoleTransport()` / `prettyStdoutTransport()` / `prettyStderrTransport()` | immediate human-readable local write | Developer UX only. Use structured transports for production delivery. |
| `memoryTransport()` | in-memory ring buffer | Diagnostic cache only; lost on process/page exit. |
| `testTransport()` | in-memory assertion sink | Test-only; not a production delivery mechanism. |
| `batchTransport(inner)` | batched queue with optional retry/circuit breaker | Use around raw I/O transports when you need queue bounds, retries, backoff, or drop accounting. |
| `retryTransport(inner)` | retried immediate delivery | Use when the inner transport already owns batching or when per-call retry is acceptable. |
| `fallbackTransport(primary, fallback)` | fallback after primary failure | Use for local backup sinks, not as a replacement for queueing. |
| `stdoutTransport()` / `stderrTransport()` | immediate stream write with drain-aware `flush()` and optional `minLength` buffering | Local process sink; `EPIPE` is treated as clean shutdown by default. |
| `fileTransport()` | shared file destination with async stream mode, optional `sync: true`, `mkdir`, `append`, `minLength`, and crash-path `flushSync()` | Local durability path; prefer one writer process per file. |
| `rotatingFileTransport()` | synchronous shared file destination with size rotation | Local durability path with size rotation; blocks the caller while writing. |
| `nodeHttpTransport()` | self-wrapped batched HTTP delivery | Uses `batchTransport`; tune queue, retry, and circuit options for production. |
| `nodeSyslogTransport()` | immediate UDP/TCP syslog write | UDP can drop; TCP still depends on socket state and close/flush behavior. |
| `workerTransport()` | worker offload with optional ready/ack lifecycle | Fire-and-forget by default; configure `readyTimeoutMs`, `ackTimeoutMs`, fallback, and `autoEnd` when worker acceptance must be observable; `ready()` waits for worker startup when a ready handshake is configured. |
| `browserHttpTransport()` | batched fetch with optional offline queue and beacon pagehide mode | Use an IndexedDB queue for reload survival; beacon mode is best-effort and size limited. |
| `memoryBrowserHttpOfflineQueue()` | in-memory offline queue | Survives network drops, not reloads or tab close. |
| `indexedDbBrowserHttpOfflineQueue()` | IndexedDB offline queue | Survives reloads while quota/storage remains available. |
| `offlineFirstTransport(remote)` | remote delivery plus persistent queue replay | Queues on offline or remote failure, then replays later. |
| `indexedDbTransport()` | local IndexedDB persistence | Local support/export store; durability depends on browser storage policy and quota. |
| `browserWebSocketTransport()` | queued while socket is closed | Reconnection is caller-owned; queued events can drop when bounded queues fill. |
| `browserServiceWorkerTransport()` | queue until active service worker is available; `ready()` can wait for `serviceWorker.ready` when `target: "ready"` | Delivery depends on registration, activation, and worker lifetime. |
| `browserBroadcastChannelTransport()` | lossy tab broadcast | Receivers must already be listening; not durable. |
| `otlpHttpTransport()` | self-wrapped batched OTLP/HTTP delivery | Uses `batchTransport`; tune retry and circuit options for production. |
| Datadog / Elastic / Loki / CloudWatch transports | raw HTTP wire delivery | Wrap with `batchTransport()` / `retryTransport()` for queueing, retry, and circuit breaking. |
| `sentryTransport()` / `openTelemetryLogBridgeTransport()` | SDK/provider adapter | Reliability follows the SDK/provider you pass in. |
| `databaseTransport()` / `sqliteTransport()` / `postgresTransport()` | batched database writes | Adapter/driver owns actual transaction and connection behavior. |

## Core / Runtime-Neutral (`@loggerjs/core`)

| Transport | What it does |
| --- | --- |
| `consoleTransport()` | Pretty per-level console output, or single-line JSON with `pretty: false`. Writes through the unpatched console so console capture cannot loop. Filters out events captured *from* the console by default. |
| `memoryTransport()` | Ring buffer of recent events (`maxEvents`, default 1000). Useful for diagnostics endpoints and tests. |
| `testTransport()` | Assertion-friendly sink: snapshots, call stats, `waitFor()`/`waitForCount()`, injectable failures. |
| `batchTransport(inner, options)` | Wraps any transport with batching, retry, and reliability controls (below). |
| `retryTransport(inner, options)` | Wraps any transport with retries, exponential backoff, optional circuit breaker, and optional fallback. `onDrop(event, reason)` reports each event it gives up on: `retry-exhausted` (no fallback), `circuit-open` (no fallback), or `fallback-failed`. |
| `fallbackTransport(primary, fallback, options)` | Sends to a fallback transport when the primary throws. `onDrop(event, "fallback-failed")` reports events neither transport accepted. |

### `batchTransport` reliability options

Every batch-based transport in the ecosystem shares this option set:

```ts
batchTransport(inner, {
  maxRecords: 100,          // flush when this many queued
  maxBytes: 64 * 1024,      // per-batch byte budget (estimation only runs when set)
  maxWaitMs: 2000,          // flush timer
  maxQueueSize: 1000,       // backpressure bound
  dropPolicy: "drop-oldest" /* | "drop-newest" | "throw" */,
  concurrency: 2,           // parallel in-flight batches
  maxRetries: 3,
  retryBaseDelayMs: 250,    // exponential backoff base
  retryMaxDelayMs: 5000,
  circuitBreakerFailureThreshold: 5,
  circuitBreakerResetMs: 30000,
  onDrop: (event, reason) => metrics.increment(`log_drop.${reason}`),
});
```

Notes:

- Byte estimation walks the payload; it is skipped entirely unless `maxBytes` is finite.
- Drops are always counted in logger meta (`transport.dropped.*`); the `onDrop` event conversion only happens when a listener is registered.
- A failed batch is re-queued at the head; the circuit breaker stops hammering a dead endpoint.
- `Retry-After` is honored. When a delivery error carries `retryAfterMs` (the HTTP transports set it from the `Retry-After` header of a 429 or 503), the next attempt waits at least that long. A wait longer than `retryMaxDelayMs` ends the current retries instead (`transport.retry.deferred`): the batch goes back to the queue, and nothing is sent until the wait ends, so `flush()` and `close()` are not held for it. `retryTransport()` follows the same rule and gives up (`retry-exhausted`) when the wait exceeds `retryMaxDelayMs`.
- A batch that goes back to the queue after a failed delivery is resent as the same batch: newer events wait behind it instead of joining it, so anything derived from the batch's events, such as an idempotency key, repeats.
- `close()` makes one final flush attempt, then stops the flush timer and always closes the inner transport. Records that could not be delivered, and records written after close, are counted as `transport.dropped.closed`; the final flush error is still thrown.

`retryTransport()` and `fallbackTransport()` have no queue: when they give up, the delivery rejects, the events are counted in `transport.dropped.*`, and `onDrop` receives each one. A drop there is final from that wrapper's point of view; if an outer transport retries rejected deliveries itself (as `batchTransport()` re-queues a failed batch), the events can still arrive later. Use `batchTransport()`'s own retry options instead of nesting `retryTransport()` inside it.

## Pretty / Developer UX (`@loggerjs/pretty`)

| Transport / helper | What it does |
| --- | --- |
| `prettyConsoleTransport()` | Browser DevTools and local console output with level labels, readable details, optional `%c` browser styles, raw object arguments, and console-capture loop filtering. |
| `prettyStreamTransport({ stream })` | Writes human-readable lines to any writable stream-like target. Uses ANSI colors when configured or when auto-detected. |
| `prettyStdoutTransport()` / `prettyStderrTransport()` | Node terminal helpers over `process.stdout` / `process.stderr`; honor `NO_COLOR` and `FORCE_COLOR`, support `minLevel`, and let `flush()` wait for `drain`. |
| `formatPrettyEvent()` | Shared formatter for custom display transports. Returns plain text, ANSI text, browser console args, and raw details. |

Pretty transports are display sinks. They do not batch, retry, persist, or speak collector protocols. See [PRETTY.md](PRETTY.md) for examples and option guidance.

## Node.js / Server (`@loggerjs/node`)

| Transport | What it does |
| --- | --- |
| `stdoutTransport()` / `stderrTransport()` | NDJSON lines with write backpressure tracking, clean `EPIPE` handling, and optional `minLength` buffering; `flush()` waits for pending writes. |
| `fileTransport({ path })` | Append NDJSON to a file by default; supports `mkdir`, `append: false`, async `minLength` buffering, `sync: true`, and `flushSync()` for crash paths. |
| `rotatingFileTransport({ path, maxBytes, maxFiles })` | Size-based rotation with numbered archives through the same file destination. Synchronous writes; use one logger process per file. If a rotation fails (for example `EBUSY`/`EPERM` while another process holds the file on Windows), the error is reported with `operation: "rotate"`, logging continues in the current file, and rotation is retried after another `maxBytes`. |
| `nodeHttpTransport({ url })` | fetch-based HTTP delivery wrapped in `batchTransport`. `timeoutMs` (default `10000`, `0` disables) aborts an attempt whose collector accepts the connection but never answers, so `flush()` and `close()` cannot stall shutdown; a timed-out attempt follows the retry settings. The collector may have processed a request that timed out, so a retry can deliver a batch twice. Set `idempotencyKeyHeader` (for example `"Idempotency-Key"`) to send a key with each request; every resend of a batch repeats it, so the collector can drop the duplicate. Keys start with a random per-transport prefix, so different processes never share one. |
| `nodeSyslogTransport()` | RFC syslog formatting over UDP/TCP; `formatSyslogMessage()` is exported separately. |
| `workerTransport({ workerScript })` | Encodes batches with a codec and posts them to a worker thread, optionally transferring buffers; supports ready timeout, batch ack waiting, fallback, and `autoEnd`. |

File and stream destinations settle `flush()` and `close()` with the stream error once a write error (`ENOSPC`, `EACCES`, `EISDIR`) has destroyed the stream, instead of waiting for a `drain` event that never comes.

`nodeHttpTransport()` accepts `transformPayload` for post-codec wire transforms. Use `nodeCompressionPayloadTransform()` for gzip, brotli, or deflate:

```ts
import { nodeHttpTransport } from "@loggerjs/node";
import { nodeCompressionPayloadTransform } from "@loggerjs/node/payload-transforms";

nodeHttpTransport({
  url: "https://collector.example/logs",
  transformPayload: nodeCompressionPayloadTransform({ format: "brotli" }),
});
```

`fileTransport().flushSync()` is a crash-path primitive. In async stream mode it writes currently buffered or pending payloads through a synchronous fd so fatal records can reach disk before process exit; if the process continues, the original async stream may still complete. Use `await flush()` for normal drain-and-continue shutdowns, or configure `sync: true` when every write must be synchronous.

`workerTransport()` remains compatible with simple workers that only receive object messages. Lifecycle is opt-in:

- Set `readyTimeoutMs` when the worker will send `{ type: "loggerjs:ready" }`. If readiness times out, LoggerJS fails the worker and sends the batch to the configured fallback or counts it as `transport.dropped.worker-ready-timeout`. Explicit `transport.ready()` / `logger.ready()` also waits for this startup handshake.
- Set `ackTimeoutMs` when the worker will acknowledge each batch with `{ type: "loggerjs:batch:ack", id }`. `flush()` waits for those acks.
- The main thread posts `{ type: "loggerjs:batch", id?, codec, contentType, count, payload }`.
- A worker can report failure with `{ type: "loggerjs:error", message, error }`; pending batches fall back or are counted as dropped.
- `autoEnd` defaults to `true`; set `autoEnd: false` if the worker is shared and should not be terminated by transport `close()`.

Worker lifecycle updates the standard transport gauges `transport.ready.<name>` and `transport.queue.depth.<name>`, and pending ack failures count `transport.worker.pending-dropped` plus `transport.dropped.<reason>`.

For Node runtime diagnostics, call `installLoggerDiagnosticsChannel()` from `@loggerjs/node`. It publishes subscribed LoggerJS internals to `diagnostics_channel` channels named `loggerjs.dispatch`, `loggerjs.transport`, `loggerjs.flush`, `loggerjs.encode`, and `loggerjs.worker`.

## Browser / Frontend (`@loggerjs/browser`)

| Transport | What it does |
| --- | --- |
| `browserHttpTransport({ url })` | Batching HTTP delivery with offline queue, online replay with backoff, and `sendBeacon` on page hide (payloads chunked to `beaconMaxBytes`). |
| `memoryBrowserHttpOfflineQueue()` | In-memory offline queue adapter (lost on reload). |
| `indexedDbBrowserHttpOfflineQueue()` | Durable offline queue in IndexedDB; survives reloads. |
| `offlineFirstTransport(remote)` | Standard remote + persistent queue wrapper; queues while offline or when remote delivery fails, then replays later. |
| `indexedDbTransport()` | Persist logs locally in IndexedDB with session-aware indexes, TTL/count/byte pruning, durability hints, optional Storage Bucket isolation, an async `query()` API, `sessions()`, and `stats()` observability. |
| `browserWebSocketTransport({ socket })` | Codec-encoded batches over a WebSocket; queues while the socket is closed (reconnection is the caller's responsibility). |
| `browserServiceWorkerTransport()` | Posts events to a service worker, queueing until one is active; with `target: "ready"`, explicit `ready()` waits for `serviceWorker.ready`. |
| `browserBroadcastChannelTransport({ channel })` | Fan logs out to other tabs (lossy by nature; receivers must be listening). |
| `exportLogsToZip(source)` / `createLogZipBlob()` / `downloadBlob()` | Bundle logs (for example from `indexedDbTransport().query()`) into a ZIP with manifest, optional per-session files, optional `recent.ndjson`/`recent.json`, and CRC for support workflows. |

`browserHttpTransport()` honors `Retry-After` from 429 and 503 responses: scheduled sends, full-batch sends, explicit `flush()`, and offline replay wait until it ends, while page-exit Beacon flushes still go out. A cross-origin collector must list `Retry-After` in `Access-Control-Expose-Headers`, or the browser hides it. `browserHttpTransport()` aborts a Fetch delivery after `timeoutMs` (default `10000`, `0` disables). Browsers never time out a request themselves, so without it one stalled request would hold every later flush and `close()`; with an offline queue configured, a timed-out batch is stored for replay. A request that timed out may still have been processed, so a batch can arrive twice. Set `idempotencyKeyHeader` to send an idempotency key with each Fetch request: retries, resends of a retained batch, and offline replays all repeat the batch's key (offline entries store it), so the collector can drop the duplicate. A cross-origin collector must allow the header in `Access-Control-Allow-Headers`, and page-exit Beacon requests cannot carry it. `close()` is terminal: events it could not deliver or store, and events logged after it, are reported through `onDrop` and `transport.dropped.closed`.

`indexedDbTransport()` reports every event of a batch whose IndexedDB write fails through `onDrop`, with reason `quota` for `QuotaExceededError` and `write-failed` otherwise. Both `indexedDbTransport()` and `indexedDbBrowserHttpOfflineQueue()` close their connection when another tab needs to upgrade or delete the database (for example a newer app version) and reopen it on next use. Events logged to `indexedDbTransport()` after `close()` are reported as dropped with reason `closed`.

`browserHttpTransport()` uses `codec` for normal Fetch delivery. Set `beaconCodec` when pagehide or hidden-page Beacon requests need a different encoding or content type; it falls back to `codec` when omitted. Beacon delivery is skipped when `transformPayload` is configured, so lifecycle flushes use the normal Fetch path and `beaconCodec` does not apply.

Beacon delivery cannot be confirmed. On `pagehide` and when the page becomes hidden (unless `useBeaconOnPageHide` is `false`), and in `close()`, `browserHttpTransport()` hands queued events to `navigator.sendBeacon()`, which only reports whether the browser queued the request. The browser sends it after the page may be gone, and nothing reports whether the collector received it. Events in an accepted request leave the queue and count toward `transport.beacon.accepted`; they are never reported through `onDrop`, which makes them the one exception to delivery accounting. Browsers cap how much Beacon data can be in flight. Events in a refused request count toward `transport.beacon.rejected` and stay queued for the next Fetch send, and `close()` sends them by Fetch or reports them as dropped. An event larger than `beaconMaxBytes` is dropped with reason `beacon-too-large`. Beacon requests carry no custom headers, so no idempotency key and none of `headers`. When every event matters, flush by Fetch at points you control, such as before an in-app navigation, so less is left for page exit, and compare collector receipts with `transport.beacon.accepted`.

`browserHttpTransport()` also accepts `transformPayload`. Use `browserCompressionPayloadTransform()` for browsers with `CompressionStream`:

```ts
import { browserHttpTransport } from "@loggerjs/browser";
import { browserCompressionPayloadTransform } from "@loggerjs/browser/payload-transforms";

browserHttpTransport({
  url: "/api/logs",
  transformPayload: browserCompressionPayloadTransform({ format: "gzip" }),
});
```

For high-throughput local browser capture on modern Chrome, prefer a dedicated IndexedDB log store with relaxed durability:

```ts
indexedDbTransport({
  durability: "relaxed",
  localStorageSpill: {
    maxBytes: 512 * 1024,
    maxEntries: 200,
    namespace: "loggerjs-support",
  },
  storageBucketName: "loggerjs-logs",
  storageBucketDurability: "relaxed",
});
```

Browsers without Storage Buckets support fall back to the regular IndexedDB instance while keeping the same transport API.

`indexedDbTransport()` assigns a page-session id by default, stores it as a top-level IndexedDB entry field, and mirrors it into `event.context.sessionId` when the event did not already provide one. Pass `session: false` to disable that materialized session field, or pass `session: { id, getId, contextKey }` to align the persisted session with your own browser context provider.

`localStorageSpill` is a last-chance reload/close safety net, not a replacement for IndexedDB. Normal logging still batches in memory and flushes to IndexedDB asynchronously. On `pagehide` or `visibilitychange: hidden`, the transport synchronously writes the still-unconfirmed tail (`pendingFlushBatch` plus the current memory buffer) to a small `localStorage` temp entry. The next transport instance drains that temp entry into IndexedDB before its first flush and clears it only after the write succeeds. This lowers loss during ordinary reloads and tab closes, but it cannot protect against process kill, browser crash, disabled storage, quota exhaustion, or storage eviction.

### Browser failure boundaries

Browser delivery is best effort unless the log has already been acknowledged by the destination you care about. These are the important loss windows:

| Path | Failure boundary / loss window | Production guidance |
| --- | --- | --- |
| `browserHttpTransport()` | In-memory batches are lost on reload, tab close, process kill, or if the queue bound drops records before delivery. Fetch can be aborted by navigation or by `timeoutMs`. Events still undelivered at `close()` are reported as dropped with reason `closed`. | Use bounded queues, retry options, and an IndexedDB offline queue when reload survival matters. |
| `browserHttpTransport({ useBeaconOnPageHide: true })` | `sendBeacon` is fire-and-forget: an accepted request is never confirmed, and its events are counted in `transport.beacon.accepted` instead of being reported through `onDrop`. Browsers cap in-flight Beacon data and can refuse a request (`transport.beacon.rejected`, the events stay queued) or lose it during shutdown. | Keep `beaconMaxBytes` conservative, flush by Fetch at points you control, treat the page-exit flush as a last chance rather than the only durability path, and reconcile collector receipts with `transport.beacon.accepted` when completeness matters. |
| `memoryBrowserHttpOfflineQueue()` | Survives temporary offline periods only while the page process stays alive. | Use for lightweight apps or tests; switch to IndexedDB for support/debug logs that must survive reload. |
| `indexedDbBrowserHttpOfflineQueue()` | Stores replay payloads across reloads, but quota, private browsing mode, storage eviction, blocked upgrades, or unavailable IndexedDB can still prevent persistence. | Monitor queue/drop counters and keep payloads bounded; pair with HTTP replay and page lifecycle flush. |
| `offlineFirstTransport(remote)` | Queues when remote delivery fails, then replays later. Replay is not a guarantee if local storage fails or is evicted. | Prefer a persistent queue adapter and call `flush()` during controlled shutdown/navigation when possible. |
| `indexedDbTransport()` | Local persistence depends on IndexedDB availability, quota, eviction policy, durability hints, and browser support for Storage Buckets. Logs still in the memory buffer can be lost before the async IndexedDB write finishes. A write that fails (including over quota) reports its events as dropped with reason `quota` or `write-failed`. | Use `durability: "relaxed"` for throughput when acceptable; use TTL/count/byte pruning to stay below quota. Enable bounded `localStorageSpill` when support logs should survive ordinary reloads more reliably. |
| `browserWebSocketTransport()` | Queued events can be lost when the page exits, the queue bound is exceeded, or the caller never reconnects the socket. | Own reconnection outside the transport and use queue bounds/drop counters to detect backpressure. |
| `browserServiceWorkerTransport()` | Delivery depends on service worker registration, activation, message delivery, and worker lifetime. A terminating worker can drop in-flight work unless it persists its own queue. | Treat it as centralization, not durability, unless the service worker also writes to durable storage. |
| `browserBroadcastChannelTransport()` | BroadcastChannel only reaches currently open, same-origin listeners. Messages are not durable and receivers can miss them during startup. | Use for multi-tab aggregation and debugging, not as a primary remote delivery guarantee. |

The usual production browser stack is HTTP batching plus an IndexedDB offline queue plus page lifecycle flush. Add a service worker or BroadcastChannel when you need centralization across tabs, but keep a durable queue in the delivery path when logs must survive reloads.

## Payload transforms

Payload transforms run after codec encoding and before a wire transport sends or stores the payload. They can return a replacement payload, or `{ payload, headers, contentType }`; HTTP transports persist those headers through offline queues and replay.

```ts
import {
  composePayloadTransforms,
  encryptionPayloadTransform,
} from "@loggerjs/core/payload-transforms";
import { browserHttpTransport } from "@loggerjs/browser";
import { browserCompressionPayloadTransform } from "@loggerjs/browser/payload-transforms";

browserHttpTransport({
  url: "/api/logs",
  transformPayload: composePayloadTransforms(
    browserCompressionPayloadTransform(),
    encryptionPayloadTransform({
      contentType: "application/octet-stream",
      headers: { "x-payload-encrypted": "1" },
      encrypt: async (payload) => encryptForCollector(payload),
    }),
  ),
});
```

`encryptionPayloadTransform()` provides the hook; the encryption algorithm and key management remain application-owned.

## Vendor packages

Vendor HTTP transports speak the wire protocol directly over `fetch`. SDK/provider adapters such as Sentry and the OpenTelemetry bridge use the SDK object or provider your app already initialized. `otlpHttpTransport()` wraps itself in `batchTransport`; Datadog, Elastic, Loki, and CloudWatch expose `logBatch`, so wrap them with core reliability wrappers when you need queueing, retry, or circuit-breaker behavior.

Production vendor usage should make the reliability wrapper visible:

```ts
import { batchTransport } from "@loggerjs/core";
import { datadogLogsTransport } from "@loggerjs/datadog";

const transport = batchTransport(datadogLogsTransport({ apiKey: process.env.DD_API_KEY }), {
  maxRecords: 100,
  maxWaitMs: 2000,
  maxQueueSize: 5000,
  maxRetries: 3,
  circuitBreakerFailureThreshold: 5,
});
```

| Package | Transport | Destination |
| --- | --- | --- |
| `@loggerjs/otel` | `otlpHttpTransport({ url })` | OTLP/HTTP JSON logs endpoint; `otlpJsonCodec()` and mapping helpers exported. |
| `@loggerjs/otel` | `openTelemetryLogBridgeTransport()` | Bridge into an OpenTelemetry `LoggerProvider`. |
| `@loggerjs/sentry` | `sentryTransport({ sentry })` | Sentry structured logs, breadcrumbs, exception/message capture. |
| `@loggerjs/datadog` | `datadogLogsTransport({ apiKey })` | Datadog Logs intake API. |
| `@loggerjs/elastic` | `elasticTransport({ url, index })` | Elasticsearch `_bulk` API with per-record index/pipeline/id selection. |
| `@loggerjs/loki` | `lokiTransport({ url })` | Grafana Loki push API with stream labels and structured metadata. |
| `@loggerjs/cloudwatch` | `cloudWatchLogsTransport({ ... })` | CloudWatch Logs `PutLogEvents` with built-in SigV4 signing. |
| `@loggerjs/database` | `sqliteTransport()` / `postgresTransport()` / `databaseTransport(adapter)` | Batched inserts through driver-agnostic adapters. |

## Writing a Custom Transport

An HTTP transport that throws `httpStatusError(name, response)` from `@loggerjs/core` for a non-2xx response gets `Retry-After` handling from `batchTransport()` and `retryTransport()`: the error carries `status` and the parsed `retryAfterMs`. `parseRetryAfter(value)` parses the header on its own.

Implement any of the four delivery methods. The simplest event transport:

```ts
import type { Transport } from "@loggerjs/core";

const myTransport: Transport = {
  name: "my-sink",
  minLevel: "info",
  log(event) {
    push(JSON.stringify(event));
  },
};
```

A record-aware transport opts into the fast path (no event projection when the logger has no processors):

```ts
import { fastEventJsonCodec } from "@loggerjs/codecs";
import { createPreparedRecordEncoder } from "@loggerjs/core/codec-prepared";

const codec = fastEventJsonCodec();
const encodeRecord = createPreparedRecordEncoder(codec);
const recordSink: Transport = {
  name: "record-sink",
  write(record, context) {
    push(encodeRecord(record));
    // Need the event shape instead? context.toEvent(record) converts once
    // and is memoized, so other transports share the same projection.
  },
};
```

Rules of the road:

- Throwing (sync or rejected promise) is safe: errors are reported to logger meta and other transports keep running. Do not swallow your own errors silently — let them surface.
- Implement `ready()` when callers can explicitly wait for startup. `logger.ready()` is opt-in; normal log calls never wait for transport readiness.
- Implement `flush()` if you buffer, `flushSync()` if you can drain synchronously on crash paths, `close()` if you hold resources.
- If you implement `close()`, include your own best-effort flush before releasing resources. Core calls `close()` when present and falls back to `flush()` only for transports without `close()`.
- Prefer `logBatch`/`writeBatch` plus `batchTransport` for anything that does I/O; per-event network calls do not survive production traffic.
- Encoding raw records directly skips the logger's `idFactory`; records get the documented `defaultRecordId`. Convert via `context.toEvent()` when custom ids matter. See [CODECS.md](CODECS.md).
