---
"@loggerjs/core": patch
---

Make `batchTransport().close()` clean up when the destination is failing. Previously a failed final flush made `close()` reject without closing the inner transport, and the retry timer kept firing after close. Close now stops the timer, always closes the inner transport, counts undelivered records (and any written after close) as `transport.dropped.closed`, and is idempotent. The final flush error is still thrown.
