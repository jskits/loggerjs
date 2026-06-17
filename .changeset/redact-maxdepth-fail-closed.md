---
"@loggerjs/processors": patch
---

Fix a plaintext secret leak in `redactProcessor`. Values nested deeper than `maxDepth` (default 8) were returned verbatim, so a configured key (e.g. `password`, `token`, `authorization`) placed past that depth was emitted **unredacted**. The depth guard now fails closed and replaces the too-deep subtree with the configured replacement, matching `privacyGuardProcessor` and `normalizeErrorProcessor`, which already fail closed at their depth limits.

Behavior change: deeply nested non-secret data past `maxDepth` is now collapsed to the replacement token instead of passing through. Raise `maxDepth` if you need deeper structured data preserved in logs.
