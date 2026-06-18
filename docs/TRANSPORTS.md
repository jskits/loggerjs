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

Transport stability describes the public API promise, not an absolute delivery
guarantee. Browser storage, process shutdown, network collectors, and vendor
backends can still fail; the reliability table below is the delivery contract.

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
| `nodeSyslogTransport()` | Stable | Wire formatting is stable; UDP/TCP reliability follows syslog transport semantics. |
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

Root package imports are convenience presets. Public transport subpaths are
documented so users can choose narrower bundles and so new built-in transports
cannot silently expand the surface without matching docs.

| Runtime | Public transport subpaths |
| --- | --- |
| Core | `@loggerjs/core/transport-console`, `@loggerjs/core/transport-batch`, `@loggerjs/core/transport-reliability`, `@loggerjs/core/transport-test` |
| Browser | `@loggerjs/browser/transport-http`, `@loggerjs/browser/transport-broadcast-channel`, `@loggerjs/browser/transport-service-worker`, `@loggerjs/browser/transport-websocket`, `@loggerjs/browser/transport-indexeddb`, `@loggerjs/browser/offline-first-transport` |
| Node.js | `@loggerjs/node/transport-http`, `@loggerjs/node/transport-file`, `@loggerjs/node/transport-rotating-file`, `@loggerjs/node/transport-stdout`, `@loggerjs/node/transport-syslog`, `@loggerjs/node/transport-worker` |
| Pretty | `@loggerjs/pretty/transport-console`, `@loggerjs/pretty/transport-stream` |
| Observability and data | `@loggerjs/otel/transport-http`, `@loggerjs/sentry/transport`, `@loggerjs/datadog/transport`, `@loggerjs/elastic/transport`, `@loggerjs/loki/transport`, `@loggerjs/cloudwatch/transport`, `@loggerjs/database/transport` |

`pnpm verify:component-docs` fails when a public transport subpath is exported
without being listed here. New entries should also update the stability and
reliability tables above.

## Reliability Posture

Transports are composable by default. Some transports include batching or durable
local storage internally; raw vendor wire transports do not retry unless you wrap
them. Treat this table as the production delivery contract:

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
| `testTransport()` | Assertion-friendly sink: snapshots, call stats, `waitForEvent()`/`waitForCount()`, injectable failures. |
| `batchTransport(inner, options)` | Wraps any transport with batching, retry, and reliability controls (below). |
| `retryTransport(inner, options)` | Wraps any transport with retries, exponential backoff, optional circuit breaker, and optional fallback. |
| `fallbackTransport(primary, fallback)` | Sends to a fallback transport when the primary throws. |

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

## Pretty / Developer UX (`@loggerjs/pretty`)

| Transport / helper | What it does |
| --- | --- |
| `prettyConsoleTransport()` | Browser DevTools and local console output with level labels, readable details, optional `%c` browser styles, raw object arguments, and console-capture loop filtering. |
| `prettyStreamTransport({ stream })` | Writes human-readable lines to any writable stream-like target. Uses ANSI colors when configured or when auto-detected. |
| `prettyStdoutTransport()` / `prettyStderrTransport()` | Node terminal helpers over `process.stdout` / `process.stderr`; honor `NO_COLOR` and `FORCE_COLOR`, support `minLevel`, and let `flush()` wait for `drain`. |
| `formatPrettyEvent()` | Shared formatter for custom display transports. Returns plain text, ANSI text, browser console args, and raw details. |

Pretty transports are display sinks. They do not batch, retry, persist, or speak
collector protocols. See [PRETTY.md](PRETTY.md) for examples and option guidance.

## Node.js / Server (`@loggerjs/node`)

| Transport | What it does |
| --- | --- |
| `stdoutTransport()` / `stderrTransport()` | NDJSON lines with write backpressure tracking, clean `EPIPE` handling, and optional `minLength` buffering; `flush()` waits for pending writes. |
| `fileTransport({ path })` | Append NDJSON to a file by default; supports `mkdir`, `append: false`, async `minLength` buffering, `sync: true`, and `flushSync()` for crash paths. |
| `rotatingFileTransport({ path, maxBytes, maxFiles })` | Size-based rotation with numbered archives through the same file destination. Synchronous writes; use one logger process per file. |
| `nodeHttpTransport({ url })` | fetch-based HTTP delivery wrapped in `batchTransport` (Node 18+). |
| `nodeSyslogTransport()` | RFC syslog formatting over UDP/TCP; `formatSyslogMessage()` is exported separately. |
| `workerTransport({ workerScript })` | Encodes batches with a codec and posts them to a worker thread, optionally transferring buffers; supports ready timeout, batch ack waiting, fallback, and `autoEnd`. |

`nodeHttpTransport()` accepts `transformPayload` for post-codec wire transforms. Use
`nodeCompressionPayloadTransform()` for gzip, brotli, or deflate:

```ts
import { nodeCompressionPayloadTransform, nodeHttpTransport } from "@loggerjs/node";

nodeHttpTransport({
  url: "https://collector.example/logs",
  transformPayload: nodeCompressionPayloadTransform({ format: "brotli" }),
});
```

`fileTransport().flushSync()` is a crash-path primitive. In async stream mode it
writes currently buffered or pending payloads through a synchronous fd so fatal
records can reach disk before process exit; if the process continues, the
original async stream may still complete. Use `await flush()` for normal
drain-and-continue shutdowns, or configure `sync: true` when every write must be
synchronous.

`workerTransport()` remains compatible with simple workers that only receive
object messages. Lifecycle is opt-in:

- Set `readyTimeoutMs` when the worker will send `{ type: "loggerjs:ready" }`.
  If readiness times out, LoggerJS fails the worker and sends the batch to the
  configured fallback or counts it as `transport.dropped.worker-ready-timeout`.
  Explicit `transport.ready()` / `logger.ready()` also waits for this startup
  handshake.
- Set `ackTimeoutMs` when the worker will acknowledge each batch with
  `{ type: "loggerjs:batch:ack", id }`. `flush()` waits for those acks.
- The main thread posts `{ type: "loggerjs:batch", id?, codec, contentType, count, payload }`.
- A worker can report failure with `{ type: "loggerjs:error", message, error }`;
  pending batches fall back or are counted as dropped.
- `autoEnd` defaults to `true`; set `autoEnd: false` if the worker is shared and
  should not be terminated by transport `close()`.

Worker lifecycle updates the standard transport gauges
`transport.ready.<name>` and `transport.queue.depth.<name>`, and pending ack
failures count `transport.worker.pending-dropped` plus
`transport.dropped.<reason>`.

For Node runtime diagnostics, call `installLoggerDiagnosticsChannel()` from
`@loggerjs/node`. It publishes subscribed LoggerJS internals to
`diagnostics_channel` channels named `loggerjs.dispatch`, `loggerjs.transport`,
`loggerjs.flush`, `loggerjs.encode`, and `loggerjs.worker`.

## Browser / Frontend (`@loggerjs/browser`)

| Transport | What it does |
| --- | --- |
| `browserHttpTransport({ url })` | Batching HTTP delivery with offline queue, online replay with backoff, and `sendBeacon` on page hide (payloads chunked to `beaconMaxBytes`). |
| `memoryBrowserHttpOfflineQueue()` | In-memory offline queue adapter (lost on reload). |
| `indexedDbBrowserHttpOfflineQueue()` | Durable offline queue in IndexedDB; survives reloads. |
| `offlineFirstTransport(remote)` | Standard remote + persistent queue wrapper; queues while offline or when remote delivery fails, then replays later. |
| `indexedDbTransport()` | Persist logs locally in IndexedDB with TTL/count/byte pruning, durability hints, optional Storage Bucket isolation, an async `query()` API, and `stats()` observability. |
| `browserWebSocketTransport({ socket })` | Codec-encoded batches over a WebSocket; queues while the socket is closed (reconnection is the caller's responsibility). |
| `browserServiceWorkerTransport()` | Posts events to a service worker, queueing until one is active; with `target: "ready"`, explicit `ready()` waits for `serviceWorker.ready`. |
| `browserBroadcastChannelTransport({ channel })` | Fan logs out to other tabs (lossy by nature; receivers must be listening). |
| `exportLogsToZip(source)` / `createLogZipBlob()` / `downloadBlob()` | Bundle logs (for example from `indexedDbTransport().query()`) into a ZIP with manifest and CRC for support workflows. |

`browserHttpTransport()` also accepts `transformPayload`. Use
`browserCompressionPayloadTransform()` for browsers with `CompressionStream`:

```ts
import { browserCompressionPayloadTransform, browserHttpTransport } from "@loggerjs/browser";

browserHttpTransport({
  url: "/api/logs",
  transformPayload: browserCompressionPayloadTransform({ format: "gzip" }),
});
```

For high-throughput local browser capture on modern Chrome, prefer a dedicated
IndexedDB log store with relaxed durability:

```ts
indexedDbTransport({
  durability: "relaxed",
  storageBucketName: "loggerjs-logs",
  storageBucketDurability: "relaxed",
});
```

Browsers without Storage Buckets support fall back to the regular IndexedDB
instance while keeping the same transport API.

### Browser failure boundaries

Browser delivery is best effort unless the log has already been acknowledged by
the destination you care about. These are the important loss windows:

| Path | Failure boundary / loss window | Production guidance |
| --- | --- | --- |
| `browserHttpTransport()` | In-memory batches are lost on reload, tab close, process kill, or if the queue bound drops records before delivery. Fetch can be aborted by navigation. | Use bounded queues, retry options, and an IndexedDB offline queue when reload survival matters. |
| `browserHttpTransport({ useBeaconOnPageHide: true })` | `sendBeacon` is fire-and-forget. Browsers cap payload size and can reject, truncate, or skip delivery under shutdown pressure. | Keep `beaconMaxBytes` conservative, treat pagehide flush as a last chance, and do not use it as the only durability path. |
| `memoryBrowserHttpOfflineQueue()` | Survives temporary offline periods only while the page process stays alive. | Use for lightweight apps or tests; switch to IndexedDB for support/debug logs that must survive reload. |
| `indexedDbBrowserHttpOfflineQueue()` | Stores replay payloads across reloads, but quota, private browsing mode, storage eviction, blocked upgrades, or unavailable IndexedDB can still prevent persistence. | Monitor queue/drop counters and keep payloads bounded; pair with HTTP replay and page lifecycle flush. |
| `offlineFirstTransport(remote)` | Queues when remote delivery fails, then replays later. Replay is not a guarantee if local storage fails or is evicted. | Prefer a persistent queue adapter and call `flush()` during controlled shutdown/navigation when possible. |
| `indexedDbTransport()` | Local persistence depends on IndexedDB availability, quota, eviction policy, durability hints, and browser support for Storage Buckets. | Use `durability: "relaxed"` for throughput when acceptable; use TTL/count/byte pruning to stay below quota. |
| `browserWebSocketTransport()` | Queued events can be lost when the page exits, the queue bound is exceeded, or the caller never reconnects the socket. | Own reconnection outside the transport and use queue bounds/drop counters to detect backpressure. |
| `browserServiceWorkerTransport()` | Delivery depends on service worker registration, activation, message delivery, and worker lifetime. A terminating worker can drop in-flight work unless it persists its own queue. | Treat it as centralization, not durability, unless the service worker also writes to durable storage. |
| `browserBroadcastChannelTransport()` | BroadcastChannel only reaches currently open, same-origin listeners. Messages are not durable and receivers can miss them during startup. | Use for multi-tab aggregation and debugging, not as a primary remote delivery guarantee. |

The usual production browser stack is HTTP batching plus an IndexedDB offline
queue plus page lifecycle flush. Add a service worker or BroadcastChannel when
you need centralization across tabs, but keep a durable queue in the delivery
path when logs must survive reloads.

## Payload transforms

Payload transforms run after codec encoding and before a wire transport sends or
stores the payload. They can return a replacement payload, or `{ payload,
headers, contentType }`; HTTP transports persist those headers through offline
queues and replay.

```ts
import {
  composePayloadTransforms,
  encryptionPayloadTransform,
} from "@loggerjs/core/payload-transforms";
import { browserCompressionPayloadTransform, browserHttpTransport } from "@loggerjs/browser";

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

`encryptionPayloadTransform()` provides the hook; the encryption algorithm and
key management remain application-owned.

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
import { createPreparedRecordEncoder } from "@loggerjs/core";

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
