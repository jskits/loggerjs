---
"@loggerjs/codecs": patch
"@loggerjs/core": patch
---

Harden the record fast path: fast-event-json now falls back to safe encoding instead of throwing on circular or BigInt payloads, the default record id is shared between core and codecs, app events stay source-free across record round trips, logger tags are frozen and shared instead of copied per record, and batch transports skip the drop event conversion when no onDrop listener is set.
