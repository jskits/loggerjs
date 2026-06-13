# Transports

A transport delivers log records or events to a destination. This page catalogs every built-in transport and shows how to write your own. Exact option types live in each package's TypeScript declarations and `api-reports/`.

## Runtime Support

| Runtime | Transport support | Notes |
| --- | --- | --- |
| Core / runtime-neutral | `consoleTransport`, `memoryTransport`, `testTransport`, `batchTransport`, `retryTransport`, `fallbackTransport` | These do not require browser or Node.js-only APIs. Wrappers work around any transport available in the current runtime. |
| Browser / frontend | `browserHttpTransport`, IndexedDB queues/store, WebSocket, service worker, BroadcastChannel, offline-first replay | Uses browser APIs such as `fetch`, `sendBeacon`, `IndexedDB`, `navigator.onLine`, service workers, and BroadcastChannel with feature detection and fallbacks where available. |
| Node.js / server | `stdoutTransport`, `stderrTransport`, `fileTransport`, `rotatingFileTransport`, `nodeHttpTransport`, `nodeSyslogTransport`, `workerTransport` | Uses Node.js streams, filesystem, worker threads, network sockets, and Node fetch. |
| Vendor / observability | OTLP, Sentry, Datadog, Elastic, Loki, CloudWatch | HTTP wire transports run where their `fetch`/crypto/runtime requirements are present; SDK/provider adapters require the application-provided SDK object or provider. Vendor credentials are usually safer on servers or trusted workers. |
| Database / local app / backend | `databaseTransport`, `postgresTransport`, `sqliteTransport` | Driver-agnostic at the LoggerJS layer, but the application must provide database drivers; intended for Node.js, Electron, CLIs, or backend workers. |

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

## Node.js / Server (`@loggerjs/node`)

| Transport | What it does |
| --- | --- |
| `stdoutTransport()` / `stderrTransport()` | NDJSON lines with write backpressure tracking; `flush()` waits for pending writes. |
| `fileTransport({ path })` | Append NDJSON to a file; supports `flushSync()` for crash paths. |
| `rotatingFileTransport({ path, maxBytes, maxFiles })` | Size-based rotation with numbered archives. Synchronous writes; use one logger process per file. |
| `nodeHttpTransport({ url })` | fetch-based HTTP delivery wrapped in `batchTransport` (Node 18+). |
| `nodeSyslogTransport()` | RFC syslog formatting over UDP/TCP; `formatSyslogMessage()` is exported separately. |
| `workerTransport({ url })` | Encodes batches with a codec and posts them to a worker thread, optionally transferring buffers; supports a fallback transport if the worker dies. |

`nodeHttpTransport()` accepts `transformPayload` for post-codec wire transforms. Use
`nodeCompressionPayloadTransform()` for gzip, brotli, or deflate:

```ts
import { nodeCompressionPayloadTransform, nodeHttpTransport } from "@loggerjs/node";

nodeHttpTransport({
  url: "https://collector.example/logs",
  transformPayload: nodeCompressionPayloadTransform({ format: "brotli" }),
});
```

## Browser / Frontend (`@loggerjs/browser`)

| Transport | What it does |
| --- | --- |
| `browserHttpTransport({ url })` | Batching HTTP delivery with offline queue, online replay with backoff, and `sendBeacon` on page hide (payloads chunked to `beaconMaxBytes`). |
| `memoryBrowserHttpOfflineQueue()` | In-memory offline queue adapter (lost on reload). |
| `indexedDbBrowserHttpOfflineQueue()` | Durable offline queue in IndexedDB; survives reloads. |
| `offlineFirstTransport(remote)` | Standard remote + persistent queue wrapper; queues while offline or when remote delivery fails, then replays later. |
| `indexedDbTransport()` | Persist logs locally in IndexedDB with TTL/count/byte pruning, durability hints, optional Storage Bucket isolation, an async `query()` API, and `stats()` observability. |
| `browserWebSocketTransport({ socket })` | Codec-encoded batches over a WebSocket; queues while the socket is closed (reconnection is the caller's responsibility). |
| `browserServiceWorkerTransport()` | Posts events to a service worker, queueing until one is active. |
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

const codec = fastEventJsonCodec();
const recordSink: Transport = {
  name: "record-sink",
  write(record, context) {
    push(codec.encode(record));
    // Need the event shape instead? context.toEvent(record) converts once
    // and is memoized, so other transports share the same projection.
  },
};
```

Rules of the road:

- Throwing (sync or rejected promise) is safe: errors are reported to logger meta and other transports keep running. Do not swallow your own errors silently — let them surface.
- Implement `flush()` if you buffer, `flushSync()` if you can drain synchronously on crash paths, `close()` if you hold resources.
- Prefer `logBatch`/`writeBatch` plus `batchTransport` for anything that does I/O; per-event network calls do not survive production traffic.
- Encoding raw records directly skips the logger's `idFactory`; records get the documented `defaultRecordId`. Convert via `context.toEvent()` when custom ids matter. See [CODECS.md](CODECS.md).
