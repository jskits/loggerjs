# @loggerjs/browser

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
