# Benchmarks

LoggerJS benchmarks are intentionally simple and reproducible. They measure public package builds from `dist`, not TypeScript source.

## Commands

```bash
pnpm bench
pnpm bench:node
pnpm bench:browser
pnpm bench:gate
pnpm size:check
```

`pnpm bench:gate` runs the Node suite and enforces regression limits as
ratios against the pino scenarios measured on the same machine, so the gate
is hardware-independent. Limits live in `scripts/check-bench-regression.mjs`
and are generous on purpose: they catch structural regressions, not noise.
CI runs the gate on every pull request.

`pnpm bench` builds the workspace first, then runs Node and browser benchmarks. Browser benchmarks use a local headless Chrome binary. Set `CHROME_BIN` when Chrome is not installed in a standard location.

### Apples-to-apples cross-logger ratios (`BENCH_AB`)

The normal suite times each logger **once**, at a different point in the run, so
its loggerjs-vs-pino ratio drifts with CPU frequency scaling and P/E-core
scheduling — a single sequential run can make either logger look better purely
by *when* it was measured. To compare two loggers fairly, use the interleaved
A/B mode:

```bash
BENCH_AB=1 node scripts/bench-node.mjs
# tune: BENCH_AB_ROUNDS (default 60), BENCH_AB_BATCH (5000), BENCH_AB_WARMUP (100000)
BENCH_AB=1 BENCH_JSON=1 node scripts/bench-node.mjs   # machine-readable
```

Each round times every contender (pino, lean, prepared) **back-to-back** and
rotates the start position, so drift hits them equally and cancels in the
**paired per-round ratio**. The report prints per-contender ns/op plus the
median ratio with its min/max spread, and warns when the baseline (pino) spread
exceeds 25% — the signal that the machine is too noisy to trust the absolute ns
(the ratios stay fair regardless). Quote a cross-logger ratio only from this
mode with a stable baseline, never from a single sequential run.

## Node Scenarios

- Disabled debug log with a lazy message.
- Enabled logger with no transports.
- Enabled logger with a no-op transport.
- Enabled logger with a record-aware no-op write transport (record fast path, no event projection).
- Console transport with a no-op patched console.
- Batch transport enqueue path.
- Full-path NDJSON comparison against pino, winston, LogTape, and Node console (see below).
- JSON, safe JSON, fast event JSON, and msgpackr encode/decode.
- Fast event JSON encoding raw LogRecord batches (record transport boundary).

## Competitor Comparison

The full-path scenarios log one structured info call per iteration and hand the
serialized line to a discarding sink, so they compare pipeline plus
serialization without terminal or filesystem I/O noise. pino, winston, and
LogTape are dev dependencies pinned in the root lockfile. The Node console
scenario uses a real `Console` instance backed by a discarding stream.

Snapshot recorded 2026-06-14 on an Apple Silicon laptop, Node v22.22.2,
pino 10.3.1, winston 3.19.0, LogTape 2.1.3, `BENCH_ITERATIONS=1000000` (a
single low-noise run), after adding codec-owned prepared record encoders. Every
ratio below is computed directly from these numbers as `pino_ns / loggerjs_ns`:

| Scenario | ns/op | ops/sec |
| --- | ---: | ---: |
| loggerjs disabled debug (lazy message) | 2 | 534,485,542 |
| pino disabled debug | 7 | 134,051,258 |
| loggerjs batch transport enqueue | 169 | 5,908,693 |
| loggerjs prepared lean record sink | 242 | 4,125,835 |
| loggerjs lean record sink | 261 | 3,830,110 |
| loggerjs fast-event-json record sink | 296 | 3,376,978 |
| loggerjs ndjson event sink | 792 | 1,263,288 |
| loggerjs fast-event-json event sink | 867 | 1,152,768 |
| pino ndjson noop sink | 230 | 4,352,791 |
| node console info noop stream | 636 | 1,571,335 |
| winston json noop sink | 2,712 | 368,774 |
| logtape json lines noop sink | 5,051 | 197,964 |

All loggerjs and pino full-path loggers carry the same base fields
(`service`, `env`). The lean record sink uses
`fastEventJsonCodec({ includeId: false, includeSeq: false, includeLevelName: false })`
to emit lean comparable lines. The prepared lean sink uses
`createPreparedRecordEncoder(codec)` so the transport reuses codec-owned logger
and tags fragments without moving serialization into the logger. The
full-envelope record sink additionally emits `id`, `seq`, and `levelName` per
line. Absolute ns/op vary run to run (the disabled path is especially
warmup-sensitive, 2-6ns); the CI-enforced figure is the **ratio** in
`pnpm bench:gate`, which uses a 100k baseline and gates both plain and prepared
lean paths.

Honest read of the numbers against the design targets:

- Disabled-level logging is at parity with pino (both single-digit ns).
- The plain lean record sink runs at **~88% of pino** in this snapshot (230/261,
  ≈1.14x), and the prepared lean record sink runs at **~95% of pino** in this
  run (230/242, ≈1.05x). Treat that prepared figure as a local snapshot, not a
  universal promise; the CI gate is intentionally looser to absorb run-to-run
  noise.
- The full-envelope record sink runs at **~78%** (230/296) while carrying three
  extra fields per line. The original design target of at least 80% of pino is
  satisfied for equivalent lean output without using a fusion fast path.
- On this run the prepared loggerjs path is ~2.6x faster than Node console
  (636/242), ~11x faster than winston (2712/242), and ~21x faster than LogTape
  (5051/242); these competitor multiples swing with system load, so treat them
  as approximate.
- An earlier snapshot showed pino at 442ns in the mixed suite; that was a JIT
  warmup artifact (10k warmup iterations), fixed by warming each scenario with
  a quarter of the measured iterations. Treat cross-logger comparisons as
  invalid unless warmup is proportionate.

Re-run `pnpm bench:node` after hot-path changes and update this snapshot when
the numbers move materially.

Tune iteration counts with:

```bash
BENCH_ITERATIONS=200000 pnpm bench:node
BENCH_BROWSER_ITERATIONS=100000 pnpm bench:browser
```

## Size Budgets

`pnpm size:check` runs after build and enforces raw plus gzip budgets for each package entry bundle. Budgets are stored in `scripts/check-size-budgets.mjs` and should be updated only with an intentional public surface or implementation-size change.
