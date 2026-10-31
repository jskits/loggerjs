---
"@loggerjs/browser": patch
---

Handle IndexedDB transaction rejections when a request fails before the transaction is awaited. This prevents extra unhandled rejections and error-capture feedback loops while preserving the original operation errors and transaction failures.
