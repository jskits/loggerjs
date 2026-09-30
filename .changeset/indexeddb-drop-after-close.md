---
"@loggerjs/browser": patch
---

`indexedDbTransport()` reports events logged after `close()` as dropped with reason `closed` instead of ignoring them silently.
