---
"@loggerjs/node": patch
---

Never truncate a log file when a file destination reopens it. With `append: false`, a failed rotation made the next write reopen the current file with `"w"` and erase the logs already written. The configured flags now apply only to the first open; every reopen appends.
