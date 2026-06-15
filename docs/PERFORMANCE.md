# Performance Guide

This page is the user-facing companion to [BENCHMARKS.md](BENCHMARKS.md) (measured numbers), [BENCHMARK-MATRIX.md](BENCHMARK-MATRIX.md) (checked-in machine evidence), and the Performance Budget section of [ARCHITECTURE.md](ARCHITECTURE.md) (targets and decisions). It tells you how to configure LoggerJS for throughput and which habits keep the hot path hot.

Reference numbers (Apple M1 Max, Node v22.21.1 — see [BENCHMARKS.md](BENCHMARKS.md) for methodology and [BENCHMARK-MATRIX.md](BENCHMARK-MATRIX.md) for the checked-in row). The loggerjs-vs-pino figures come from the paired A/B harness; ranking vs pino is CPU/Node-V8 dependent — reproduce with `BENCH_AB=1 pnpm bench:node`:

| Path | Cost |
| --- | ---: |
| Disabled level call | ~3 ns (pino parity) |
| Enabled pipeline, record fast path, noop sink | ~83 ns |
| Batch transport enqueue (default settings) | ~172 ns |
| Prepared lean NDJSON line to a sink | ~224 ns (1.28× pino) |
| Lean NDJSON line to a sink | ~242 ns (1.19× pino) |
| Full NDJSON line with id/seq/levelName | ~307 ns |

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
- Prepared record encoders help custom sinks. When a record-aware transport writes a codec directly, wrap the codec once with `createPreparedRecordEncoder(codec)` so codec-owned logger/tag fragments can be reused without moving serialization into the logger.
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

## Import Boundaries

The root `@loggerjs/browser` and `@loggerjs/node` entries are preset-style
convenience imports: they re-export core plus every first-party runtime
transport and integration. Use them when application simplicity matters more
than the smallest possible module graph.

For tighter bundles, import the documented subpaths. Browser and Node subpaths
are built as physical entry bundles and verified by `pnpm verify:entry-boundaries`,
so a focused import does not point back at the aggregate `dist/index` file:

```ts
import { browserHttpTransport } from "@loggerjs/browser/transport-http";
import { captureFetchIntegration } from "@loggerjs/browser/integration-fetch";
import { stdoutTransport } from "@loggerjs/node/transport-stdout";
```

Keep new runtime-specific features behind a subpath entry when they are not part
of the common preset path. If a new feature makes the root browser/node bundle
larger, the size-budget diff should explain why the preset entry needs it.

## Guardrails

Performance is gated in CI: `pnpm bench:gate` measures the suite and enforces machine-independent ratios against pino on the same hardware (see BENCHMARKS.md). If you contribute changes to the hot path, run it locally; structural regressions fail the pull request.

The deliberate end-state of optimization is documented in ARCHITECTURE.md: keep the shared `LogRecord` pipeline as the default architecture, but allow codec/transport-owned preparation for stable fragments. Fusion paths that bypass the record remain rejected as the default because they would create a separate semantic hot path.
