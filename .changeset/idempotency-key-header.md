---
"@loggerjs/core": patch
"@loggerjs/node": minor
"@loggerjs/browser": minor
---

Add `idempotencyKeyHeader` to `nodeHttpTransport()` and `browserHttpTransport()`. When set (for example to `"Idempotency-Key"`), each request carries a key made of a random per-transport prefix and a batch number. Every resend of a batch repeats its key, including retries after a timeout, resends after the batch went back to the queue, and browser offline replays (offline entries store the key), so a collector can drop the duplicates that a retry after a timeout may cause. The option is off by default. A cross-origin collector must allow the header in `Access-Control-Allow-Headers`, and Beacon requests cannot carry it. An invalid header name throws a `TypeError` when the transport is created.

`batchTransport()` and `browserHttpTransport()` now resend a batch that went back to the queue after a failed delivery as the same batch. Newer events wait behind it instead of joining it.
