---
"@loggerjs/node": patch
---

Stop `flush()` and `close()` from hanging after a file or stream destination fails. Once a stream was destroyed by a write error such as `ENOSPC`, `EACCES`, or `EISDIR`, the next write returned `false` and the destination waited for a `drain` event that a destroyed stream never emits, so every later `logger.flush()` and `logger.close()` stayed pending forever and graceful shutdown hung. They now settle with the stream error. `WritableLike` gains an optional `destroyed` flag, which Node streams already provide.
