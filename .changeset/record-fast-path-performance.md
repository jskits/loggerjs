---
"@loggerjs/core": patch
"@loggerjs/codecs": patch
---

Hot-path performance round: memoize the time segment of default ids, inline record construction and context lookup in log(), share one transport context per logger, stop wrapping sync transport results in promises, and pass precomputed level constants from convenience methods. fast-event-json gains cached level/logger/tags/time fragments, a scan-based string escape fast path, a flat data object writer, and lean envelope options (includeId/includeSeq/includeLevelName). The full NDJSON path improves from ~30% to ~83% of pino throughput for equivalent output.
