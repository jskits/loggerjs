---
"@loggerjs/core": patch
"@loggerjs/browser": patch
---

Forward `ready()` through wrapper transports. `batchTransport()`, `retryTransport()`, `fallbackTransport()`, and `offlineFirstTransport()` did not expose the wrapped transport's `ready()`, so `logger.ready()` stopped waiting for startup handshakes (for example a worker or WebSocket transport) as soon as it was wrapped. Wrappers now expose `ready()` whenever a wrapped transport has one.
