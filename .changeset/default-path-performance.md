---
"@loggerjs/core": patch
---

Make the default paths fast: batch transports skip byte estimation when maxBytes is unbounded (default batch enqueue drops from ~797ns to ~166ns per log), and ndjsonCodec adopts the fast-by-default contract — native JSON.stringify per line with a safe re-encode fallback for lines that throw, and full safe normalization when any safe option is set. safeJsonCodec semantics are unchanged.
