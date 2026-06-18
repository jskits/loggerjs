---
"@loggerjs/processors": patch
---

Fix two additional Error hardening paths in `redactProcessor` and `privacyGuardProcessor`.

- `privacyGuardProcessor` now scans raw `Error.message` and `Error.stack` strings before cloning errors, so PII embedded directly in native error text is guarded instead of passing through.
- `redactProcessor` and `privacyGuardProcessor` now preserve native non-enumerable `cause` and `AggregateError.errors` fields while recursively redacting or guarding their contents.
