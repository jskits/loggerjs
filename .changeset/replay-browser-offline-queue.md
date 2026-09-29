---
"@loggerjs/browser": patch
---

Replay the `browserHttpTransport` offline queue without waiting for an `online` event. Stored payloads are now replayed shortly after the transport is created (so an IndexedDB queue from an earlier page load is drained; opt out with `offlineReplayOnStart: false`), after a flush in which a live batch reached the collector, and on an explicit `flush()` with no live logs pending. Previously, batches queued during a server outage while the browser stayed online, and payloads persisted before a reload, were only sent after connectivity dropped and returned. A failed replay keeps the entries queued and is reported through `onInternalError`.
