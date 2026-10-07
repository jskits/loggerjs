# @loggerjs/browser

## 0.7.0

### Minor Changes

- `browserHttpTransport()` now counts what it hands to `navigator.sendBeacon()`: events in requests the browser accepted add to `transport.beacon.accepted`, and events in requests it refused add to `transport.beacon.rejected` (they stay queued for Fetch). `sendBeacon()` only reports that the browser queued a request, so accepted events are never confirmed and never reported through `onDrop`. The transport docs and the delivery accounting contract now describe this exception and how to reconcile against the counter.

- `browserHttpTransport().close()` is now terminal. Events it could not deliver or store are reported as dropped with reason `closed`, and events logged after `close()` are dropped the same way. Previously they stayed in the closed transport without reaching `onDrop` or the drop counters, and a later `flush()` could still send them.

- Add `timeoutMs` to `browserHttpTransport()`, defaulting to 10 seconds (`0` disables). Browsers never time out a request on their own, so one stalled request previously held every later flush and `close()` until the page unloaded. With an offline queue configured, a timed-out batch is stored for replay.

  A collector may have processed a request that timed out before it answered, so the batch can be delivered twice. Deduplicate on the event `id` on the collector side if duplicates matter, and raise `timeoutMs` for large batches on slow networks.

- Deprecate the root re-exports of compatible components. In 1.0 the `@loggerjs/browser` and `@loggerjs/node` roots export only the core kernel and their stable components (browser: `browserHttpTransport`, the IndexedDB stores, `offlineFirstTransport`, and the console, error, context, and page-lifecycle integrations; Node: stdout, stderr, file, rotating-file, and HTTP transports, process capture, and AsyncLocalStorage context) and become stable. The other root exports keep working in 0.x and are marked `@deprecated`; import them from their subpaths, for example `captureFetchIntegration` from `@loggerjs/browser/integration-fetch` or `expressIntegration` from `@loggerjs/node/integration-express`. MIGRATION lists the subpath for every export.

- Add `idempotencyKeyHeader` to `nodeHttpTransport()` and `browserHttpTransport()`. When set (for example to `"Idempotency-Key"`), each request carries a key made of a random per-transport prefix and a batch number. Every resend of a batch repeats its key, including retries after a timeout, resends after the batch went back to the queue, and browser offline replays (offline entries store the key), so a collector can drop the duplicates that a retry after a timeout may cause. The option is off by default. A cross-origin collector must allow the header in `Access-Control-Allow-Headers`, and Beacon requests cannot carry it. An invalid header name throws a `TypeError` when the transport is created.

  `batchTransport()` and `browserHttpTransport()` now resend a batch that went back to the queue after a failed delivery as the same batch. Newer events wait behind it instead of joining it.

- Honor `Retry-After`. HTTP transports now throw `httpStatusError()` for non-2xx responses, which carries `status` and, when the response sends `Retry-After` (delay-seconds or an HTTP-date), `retryAfterMs`. `batchTransport()` and `retryTransport()` wait at least that long before the next attempt. A wait longer than `retryMaxDelayMs` ends the current retries instead: `batchTransport()` puts the batch back and sends nothing until the wait ends (counted as `transport.retry.deferred`), and `retryTransport()` gives up with reason `retry-exhausted`, so `flush()` and `close()` are never held by a long server-requested wait. `browserHttpTransport()` pauses scheduled, full-batch, and explicit sends and offline replay until the wait ends; cross-origin collectors must expose `Retry-After` through `Access-Control-Expose-Headers`.

  `parseRetryAfter()` and `httpStatusError()` are exported from `@loggerjs/core` for custom HTTP transports. Error messages are unchanged.

### Patch Changes

- Depend on `@loggerjs/core` with a caret range instead of an exact version. Upgrading `@loggerjs/core` on its own no longer forces the package manager to install a second copy of core underneath each LoggerJS package.

- Declare `engines.node: ">=20.19.0"`, the oldest Node release the packed packages are smoke-tested on in CI. Package managers can now warn when LoggerJS is installed on an older Node.

- Import core helpers that leave the `@loggerjs/core` root in 1.0 (payload transforms, trace propagation, diagnostics, integration helpers, and event routes) from their `@loggerjs/core/*` subpaths. These packages now need `@loggerjs/core` 0.7 or later, which their dependency range already requires.

- `indexedDbTransport()` reports events logged after `close()` as dropped with reason `closed` instead of ignoring them silently.

- Stop `indexedDbTransport()` from losing events logged while a write is in progress. A flush started during an in-flight write returned that write's promise without writing the newly buffered events, and with `flushIntervalMs: 0` no timer picked them up afterwards, so `close()`, `pagehide`, and full-batch flushes could finish with events still in memory that were never stored or reported. A flush now waits for the in-flight write and then writes what was buffered meanwhile, and with `flushIntervalMs: 0` leftover events are written as soon as the previous write finishes.

- `indexedDbTransport()` and `indexedDbBrowserHttpOfflineQueue()` close their connection when another tab needs to upgrade or delete the database, and reopen it on next use. Previously an open tab blocked a newer app version in another tab from upgrading the database.

- `indexedDbTransport()` reports every event in a batch whose IndexedDB write fails as dropped, with reason `quota` for `QuotaExceededError` and `write-failed` otherwise. Previously the batch had already left the buffer and disappeared without a drop report.

- Smaller application bundles. `createLogger()` with `consoleTransport()` drops from about 6.3 KB to 5.5 KB gzip after tree-shaking and minification, `browserHttpTransport()` from 8.5 KB to 7.8 KB, and `stdoutTransport()` from 6.9 KB to 6.2 KB.

  - New `safeJsonEncoder()` and `ndjsonEncoder()` in `@loggerjs/core/codec-json` are `safeJsonCodec()` and `ndjsonCodec()` without `decode()`. Transports that only send logs (browser and Node HTTP, WebSocket, worker, database, Node stdout and file) default to them, and `consoleTransport({ pretty: false })` encodes the same way, so apps that never decode leave out the payload validation. Output is unchanged.
  - Diagnostics instrumentation is removed entirely from bundles that never install a diagnostics sink, instead of leaving inert checks behind.

- Updated dependencies:
  - @loggerjs/core@0.7.0

## 0.6.0

### Minor Changes

- Replay the `browserHttpTransport` offline queue without waiting for an `online` event. Stored payloads are now replayed shortly after the transport is created (so an IndexedDB queue from an earlier page load is drained), after a flush in which a live batch reached the collector, and on an explicit `flush()` with no live logs pending. Previously, batches queued during a server outage while the browser stayed online, and payloads persisted before a reload, were only sent after connectivity dropped and returned. A failed replay keeps the entries queued and is reported through `onInternalError`. Set the new `offlineReplayOnStart: false` option to skip the replay at creation.

### Patch Changes

- `offlineFirstTransport()` now forwards the remote transport's `ready()`, so `logger.ready()` waits for its startup handshake.
- Updated dependencies:
  - @loggerjs/core@0.6.0

## 0.5.6

### Patch Changes

- Fixed `browserHttpTransport()` to enforce `maxBatchSize` on new Fetch and Beacon batches. Fetch batches drain serially, including partial tails when flush timers are disabled, and concurrent `flush()` / `close()` calls wait for active delivery.
- Failed Fetch batches retain their queue order without replaying earlier successful batches. Lifecycle Beacon submission can drain queued events while Fetch is pending; partial Beacon failures retain only unsent events.
- `maxBatchSize` must now be a positive safe integer. Smaller batches can increase request and codec/transform counts; offline entry limits count requests, and existing offline payloads replay unchanged. The event limit does not impose a Fetch byte budget or global ordering across offline replay, live delivery, and Beacon.
- Added unit and Chromium pagehide E2E coverage for batch limits, queue draining, and lifecycle delivery.
- Updated dependencies:
  - @loggerjs/core@0.5.6

## 0.5.5

### Patch Changes

- Added optional `beaconCodec` support to `browserHttpTransport()` so Beacon delivery on pagehide, hidden-page flushes, and transport close can use a separate encoding and content type. Fetch delivery continues to use `codec`, and `beaconCodec` defaults to `codec` when omitted.
- Beacon chunk sizes are calculated from the Beacon codec's encoded payload. When `transformPayload` is configured, lifecycle flushes continue to use Fetch and do not apply `beaconCodec`.
- Added unit and Chromium pagehide E2E coverage for Beacon-specific payloads and content types.
- Updated dependencies:
  - @loggerjs/core@0.5.5

## 0.5.4

### Patch Changes

- Added durable IndexedDB session summaries in a separate metadata store, migrated existing stores to DB version 4, and made `sessions()` read ordered summaries without scanning every persisted log entry.
- Fixed IndexedDB session metadata maintenance when entries are flushed, overwritten, pruned, removed, or cleared, including serialization between `clear()`, in-flight flushes, and localStorage spill draining.
- Added short support-log setup examples that use stable `@loggerjs/browser/transport-indexeddb` and `@loggerjs/browser/export-zip` subpath imports.
- Expanded browser runtime fallback coverage for BroadcastChannel, WebSocket, ReportingObserver, and browser HTTP delivery, and raised the browser package and HTTP transport coverage floors.
- Updated dependencies:
  - @loggerjs/core@0.5.4

## 0.5.3

### Patch Changes

- Added session-aware `indexedDbTransport()` persistence: entries can carry `sessionId`, page sessions are assigned by default, `query({ sessionId })` filters by session, and `sessions()` summarizes persisted sessions for support tooling.
- Added bounded `localStorageSpill` for the still-unconfirmed IndexedDB write tail, including pagehide/hidden-visibility spill, startup drain, spill counters, and budget/drop accounting.
- Extended `exportLogsToZip()` with per-session files, manifest session metadata, and optional `recent.ndjson` / `recent.json` exports.
- Kept `offlineFirstTransport()` replay payloads stable by disabling the new IndexedDB page-session tagging for its internal queue unless queue options explicitly opt in.
- Hardened browser HTTP/offline contracts for missing `fetch`, non-2xx responses, transform failures, offline replay backoff, beacon fallback/oversize handling, and retained retry batches.
- Pointed browser transport/integration subpath exports at physical bundles and added package export verification.
- Updated dependencies:
  - @loggerjs/core@0.5.3

## 0.5.2

- Version alignment for package release `0.5.2`.
- No package runtime source changes landed between the `0.5.1` and `0.5.2` package releases.
- Updated dependency `@loggerjs/core` to the matching release.

This changelog has been corrected against the git tag history. Untagged generated entries that were later reset are folded into the tagged release where their commits shipped.

## 0.5.1

- Split public transport/integration subpath exports into physical entry bundles so narrow imports do not point at the aggregate bundle.
- Added real-browser E2E coverage for IndexedDB offline queue replay, pagehide `sendBeacon`, and service worker delivery.
- Updated dependency `@loggerjs/core` to the matching release.

## 0.5.0 - 2026-06-15 (repository tag `v0.5.0`)

- Version alignment for repository tag `v0.5.0`.
- No package runtime source changes landed between `v0.4.0` and `v0.5.0`.

## 0.4.0 - 2026-06-15 (repository tag `v0.4.0`)

- Version alignment for repository tag `v0.4.0`.
- Release focused on docs site, generated references, localization, agent skill docs, and npm Trusted Publisher/OIDC workflow hardening.

## 0.3.1 - 2026-06-14 (repository tag `v0.3.1`)

- Version alignment for repository tag `v0.3.1`.
- Added IndexedDB offline-path benchmark/test coverage; no browser public API changes.
- Updated dependency `@loggerjs/core` to the matching release.

## 0.3.0 - 2026-06-13 (repository tag `v0.3.0`)

- Exposed service worker transport readiness for `target: "ready"` and documented browser transport loss windows.
- Expanded browser integration test coverage for console, errors, fetch/XHR, page lifecycle, Web Vitals, Performance, Reporting, routers, runtime host, user actions, WebSocket, and service worker behavior.
- Updated dependency `@loggerjs/core` to the matching release.

## 0.1.0 - 2026-06-13 (repository tag `v0.2.0`)

- Added offline-first transport, id-based IndexedDB log removal, context propagation integration, framework router adapters, and browser compression payload transform.
- Fixed offline queue replay without prior context and retained HTTP batches on payload transform failure.
- Added Chromium browser example E2E coverage.
- Updated dependency `@loggerjs/core` to the matching release.

## 0.0.2 - 2026-06-12 (package tag `@loggerjs/browser@0.0.2`)

- Republished through the explicit provenance publishing path.
- Updated dependency `@loggerjs/core` to the matching release.

## 0.0.1 - 2026-06-12 (package tag `@loggerjs/browser@0.0.1`)

- Initial browser package with HTTP batching, pagehide beacon delivery, offline queues, IndexedDB storage/export, WebSocket, BroadcastChannel, Service Worker transport, and browser integrations.
- Updated dependency `@loggerjs/core` to the matching release.
