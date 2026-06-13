# Performance Guide

This page is the user-facing companion to [BENCHMARKS.md](BENCHMARKS.md) (measured numbers) and the Performance Budget section of [ARCHITECTURE.md](ARCHITECTURE.md) (targets and decisions). It tells you how to configure LoggerJS for throughput and which habits keep the hot path hot.

Reference numbers (Apple Silicon, Node 22 — see BENCHMARKS.md for the full table):

| Path | Cost |
| --- | ---: |
| Disabled level call | ~5 ns |
| Enabled pipeline, record fast path, noop sink | ~101 ns |
| Batch transport enqueue (default settings) | ~173 ns |
| Full NDJSON line to a sink (lean envelope) | ~267 ns (~84% of pino, ≈1.20×) |
| Full NDJSON line with id/seq/levelName | ~301 ns (~74% of pino) |

## Free Wins (Defaults Already Do This)

- **Disabled levels cost one comparison.** Leave `trace`/`debug` calls in your code; gate with `level`.
- **Lazy messages** are only evaluated when the level is enabled, at most once: `logger.debug(() => expensive())`.
- **Logger tags are frozen and shared** across records — no per-call copy.
- **Default ids memoize** their timestamp segment per millisecond.
- **Batch byte estimation is skipped** unless you set a finite `maxBytes`.
- **`ndjsonCodec` runs the native fast path** by default with a safe fallback for inputs that would throw.

## The Record Fast Path

The single biggest configuration lever. When a logger has **zero processors** and its transports are **record-aware** (`write`/`writeBatch`), no `LogEvent` is ever built: no id factory, no message-error projection, no second object.

```ts
// Fast path: middleware + record-aware transport
createLogger({
  middleware: [tagsMiddleware({ service: "checkout" })], // middleware keep the fast path
  transports: [recordAwareTransport],
});

// Leaves the fast path: any processor forces event projection per log
createLogger({
  processors: [sampleProcessor()],
  transports: [recordAwareTransport],
});
```

Practical guidance:

- Prefer the middleware variants (`tagsMiddleware`, `enrichMiddleware`, `traceContextMiddleware`, …) over their processor twins when both exist.
- Processors are still the right tool for event-shape behavior (routing, fingerprinting, fingers-crossed). Accept the projection cost when you need them — it is ~100ns, not a catastrophe.

## Codec Choice

- Highest throughput: `fastEventJsonCodec()` from `@loggerjs/codecs`, optionally with the lean envelope (`includeId/includeSeq/includeLevelName: false`) when downstream does not need those fields.
- `ndjsonCodec()` (the stdout default) is within ~10% of fast-event-json on the event path.
- `safeJsonCodec()` pays a full normalization walk per item — use it where hostile payloads are routine, not as the throughput path.
- Custom `idFactory` (UUIDs etc.) costs per-log; the default id is near-free and sortable.

## Batching for Remote Destinations

Per-event network calls are the dominant real-world cost; every remote transport here is built on `batchTransport`:

- `maxRecords` / `maxWaitMs` trade latency for batch size; defaults (50 / 2000ms) suit most services.
- Set `maxBytes` only when the destination enforces payload limits — enabling it turns on per-log byte estimation.
- `concurrency: 2..4` overlaps slow endpoint round trips.
- Watch `getLoggerMetaStats()` for `transport.dropped.*` — drops mean the queue bound and your traffic disagree.

## Habits That Hurt

- **Heavy synchronous work in middleware/processors.** The pipeline is synchronous by design; a 1ms enrichment makes every log 1ms.
- **Pre-stringifying in the pipeline.** Serialization belongs to the transport codec; stringified blobs also defeat redaction.
- **Logging through one shared catch-all logger with many processors** when only one route needs them — split loggers by purpose; children are cheap.
- **Unbounded data payloads.** Encoding cost is proportional to payload size; log identifiers, not entire entities.

## Guardrails

Performance is gated in CI: `pnpm bench:gate` measures the suite and enforces machine-independent ratios against pino on the same hardware (see BENCHMARKS.md). If you contribute changes to the hot path, run it locally; structural regressions fail the pull request.

The deliberate end-state of optimization is documented in ARCHITECTURE.md ("80% of pino is the accepted ceiling"): LoggerJS allocates one record per log so middleware, integrations, and multiple transports can observe it — that is the architecture's value, and the remaining gap to pino is the price, accepted with eyes open.
