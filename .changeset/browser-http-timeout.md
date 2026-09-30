---
"@loggerjs/browser": minor
---

Add `timeoutMs` to `browserHttpTransport()`, defaulting to 10 seconds (`0` disables). Browsers never time out a request on their own, so one stalled request previously held every later flush and `close()` until the page unloaded. With an offline queue configured, a timed-out batch is stored for replay.

A collector may have processed a request that timed out before it answered, so the batch can be delivered twice. Deduplicate on the event `id` on the collector side if duplicates matter, and raise `timeoutMs` for large batches on slow networks.
