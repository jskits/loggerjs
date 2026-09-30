---
"@loggerjs/node": minor
---

Add `timeoutMs` to `nodeHttpTransport()`, defaulting to 10 seconds. Previously a collector that accepted the connection but never answered left the delivery pending until undici's five-minute headers timeout, so `logger.flush()` and `logger.close()` stalled graceful shutdown well past typical termination grace periods. A timed-out attempt now fails like any other and follows the retry settings; events still queued at `close()` are reported as `transport.dropped.closed`. Set `timeoutMs: 0` to restore the previous behavior.

A collector may have processed a request that timed out before it answered, so a retry can deliver the same events twice. Deduplicate on the event `id` on the collector side if duplicates matter.
