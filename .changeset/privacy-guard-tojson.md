---
"@loggerjs/processors": patch
---

`privacyGuardProcessor()` now scans values that serialize through `toJSON()`. It only walked own enumerable properties, so a `URL` (which has none) was passed through unscanned and an email or token in its query string reached the transport; custom `toJSON()` output was not scanned either. The serialized form is now guarded, the original object is kept when nothing needs redaction, and a throwing `toJSON()` is replaced.
