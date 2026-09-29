---
"@loggerjs/core": patch
---

Calling `configure()` again without `reset: true` now replaces the previous configuration instead of leaking it. Previously the earlier integrations stayed installed (so console, fetch, and similar hooks were patched twice and captured duplicates) and transports dropped from the configuration were never flushed or closed. Reconfiguring now tears down the previous integrations before installing the new ones and closes transports that are no longer referenced; transports passed again stay open.
