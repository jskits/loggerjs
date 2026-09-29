---
"@loggerjs/node": patch
---

Stop `fileTransport({ append: false })` from erasing the log file on the crash path. In async stream mode, `flushSync()` opened its synchronous file descriptor with the same `"w"` flag as the stream, which truncated everything already written before appending the fatal lines. The crash-path descriptor now always appends; `sync: true` mode still truncates once when the file is opened.
