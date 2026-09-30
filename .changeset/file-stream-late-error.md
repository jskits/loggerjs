---
"@loggerjs/node": patch
---

Stop a file write that fails after `close()` from crashing the process. `fileTransport()` removed its error listener when closing, so a write error surfacing afterwards (for example `ENOSPC` while the last buffered chunk is flushed to a full disk) was an unhandled `error` event. File destinations now keep an error listener on the stream they own for its whole life.
