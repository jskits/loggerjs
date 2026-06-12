# @loggerjs/core

## 0.1.1

### Patch Changes

- [`d9cc28e`](https://github.com/jskits/loggerjs/commit/d9cc28eaf1dae0ac9ae174830a8998f7909edfe7) Thanks [@unadlib](https://github.com/unadlib)! - Make the default paths fast: batch transports skip byte estimation when maxBytes is unbounded (default batch enqueue drops from ~797ns to ~166ns per log), and ndjsonCodec adopts the fast-by-default contract — native JSON.stringify per line with a safe re-encode fallback for lines that throw, and full safe normalization when any safe option is set. safeJsonCodec semantics are unchanged.

- [`f6e9ec1`](https://github.com/jskits/loggerjs/commit/f6e9ec19b35912a2610b6279f07064d96d90f268) Thanks [@unadlib](https://github.com/unadlib)! - Hot-path performance round: memoize the time segment of default ids, inline record construction and context lookup in log(), share one transport context per logger, stop wrapping sync transport results in promises, and pass precomputed level constants from convenience methods. fast-event-json gains cached level/logger/tags/time fragments, a scan-based string escape fast path, a flat data object writer, and lean envelope options (includeId/includeSeq/includeLevelName). The full NDJSON path improves from ~30% to ~83% of pino throughput for equivalent output.

- [`fb2a4d4`](https://github.com/jskits/loggerjs/commit/fb2a4d40e93a8c085a942d7eee0d32e980a16ff8) Thanks [@unadlib](https://github.com/unadlib)! - Harden the record fast path: fast-event-json now falls back to safe encoding instead of throwing on circular or BigInt payloads, the default record id is shared between core and codecs, app events stay source-free across record round trips, logger tags are frozen and shared instead of copied per record, and batch transports skip the drop event conversion when no onDrop listener is set.
