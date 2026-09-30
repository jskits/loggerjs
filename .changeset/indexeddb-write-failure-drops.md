---
"@loggerjs/browser": patch
---

`indexedDbTransport()` reports every event in a batch whose IndexedDB write fails as dropped, with reason `quota` for `QuotaExceededError` and `write-failed` otherwise. Previously the batch had already left the buffer and disappeared without a drop report.
