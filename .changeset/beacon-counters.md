---
"@loggerjs/browser": minor
---

`browserHttpTransport()` now counts what it hands to `navigator.sendBeacon()`: events in requests the browser accepted add to `transport.beacon.accepted`, and events in requests it refused add to `transport.beacon.rejected` (they stay queued for Fetch). `sendBeacon()` only reports that the browser queued a request, so accepted events are never confirmed and never reported through `onDrop`. The transport docs and the delivery accounting contract now describe this exception and how to reconcile against the counter.
