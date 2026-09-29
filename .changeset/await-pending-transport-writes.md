---
"@loggerjs/core": patch
---

`logger.flush()` and `logger.close()` now wait for asynchronous transport writes that are still in flight, including writes started by child loggers, before flushing or closing the transports. `retryTransport()` and `fallbackTransport()` also track their in-flight deliveries so their own `flush()` and `close()` wait for them. Previously, logs sent through these wrappers or through raw vendor transports could still be on the wire when `flush()` resolved, and were lost on shutdown.
