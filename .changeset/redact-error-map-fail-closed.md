---
"@loggerjs/processors": patch
---

Fix two secret-leak / data-loss paths in `redactProcessor` and `privacyGuardProcessor`.

- **Error own properties leaked in plaintext.** Both processors returned `Error` instances verbatim, so a configured key carried on an error (e.g. `Object.assign(err, { password })`, common when an error is nested in `data`/`context`) was emitted unredacted — `JSON.stringify` and `safeJsonStringify` both serialize an Error's own-enumerable properties. They now recurse into an Error's own-enumerable properties (redacting/guarding matches) while preserving the non-enumerable `name`/`message`/`stack`, so default output is unchanged apart from the redaction.
- **Map/Set contents were silently dropped.** `Map`/`Set` fell through to `Object.entries()` (always `[]`), so `{ creds: new Map([["password", "secret"]]) }` serialized as `{ "creds": {} }` — no leak, but legitimate Map/Set data vanished and behavior diverged under the safe codec. They are now traversed: string-keyed `Map` entries are redacted/guarded by key, `Set` members are recursed, and the `Map`/`Set` type is preserved.

Inputs are never mutated. This complements the earlier maxDepth fail-closed fix.
