---
"@loggerjs/browser": patch
---

Stop `indexedDbTransport()` from losing events logged while a write is in progress. A flush started during an in-flight write returned that write's promise without writing the newly buffered events, and with `flushIntervalMs: 0` no timer picked them up afterwards, so `close()`, `pagehide`, and full-batch flushes could finish with events still in memory that were never stored or reported. A flush now waits for the in-flight write and then writes what was buffered meanwhile, and with `flushIntervalMs: 0` leftover events are written as soon as the previous write finishes.
