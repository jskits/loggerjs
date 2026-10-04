---
"@loggerjs/node": patch
---

Keep logging when `rotatingFileTransport()` cannot rotate. Previously a failed rename (for example `EBUSY` or `EPERM` while another process holds the log file open on Windows) threw out of every later write, so all subsequent logs were dropped. A failed automatic rotation is now reported through `reportInternalError` with `operation: "rotate"`, logging continues in the current file, and rotation is retried after another `maxBytes`.
