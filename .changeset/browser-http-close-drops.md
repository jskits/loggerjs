---
"@loggerjs/browser": minor
---

`browserHttpTransport().close()` is now terminal. Events it could not deliver or store are reported as dropped with reason `closed`, and events logged after `close()` are dropped the same way. Previously they stayed in the closed transport without reaching `onDrop` or the drop counters, and a later `flush()` could still send them.
