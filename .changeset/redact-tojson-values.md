---
"@loggerjs/processors": patch
---

`redactProcessor()` no longer destroys values that serialize through `toJSON()`. It rebuilt every object from its own enumerable properties, so a `URL` in log data became `{}` and custom `toJSON()` output was replaced by raw fields. Such values are now redacted in the form they serialize to (a `URL` stays its string); if `toJSON()` throws, the value is replaced so the event never passes through unredacted.
