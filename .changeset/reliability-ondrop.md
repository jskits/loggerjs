---
"@loggerjs/core": minor
---

Add `onDrop(event, reason)` to `retryTransport()` and `fallbackTransport()`. When a wrapper gives up on a delivery, it now counts the events in `transport.dropped` and `transport.dropped.<reason>` and hands each one to `onDrop`, with reason `retry-exhausted` (retries ran out and there is no fallback), `circuit-open` (the circuit was open and there is no fallback), or `fallback-failed` (the fallback failed too). Previously only `transport.retry.exhausted` and `transport.circuit.skipped` were counted, and callers could not tell which events were lost. The delivery still rejects as before, and an `onDrop` callback that throws is reported as an internal error without replacing the delivery error.
