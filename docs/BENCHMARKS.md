# Benchmarks

LoggerJS benchmarks are intentionally simple and reproducible. They measure public package builds from `dist`, not TypeScript source.

## Commands

```bash
pnpm bench
pnpm bench:node
pnpm bench:browser
pnpm bench:gate
pnpm bench:matrix -- --runs=5 --rounds=120 --label="$(hostname)-node22"
pnpm bench:matrix:aggregate -- benchmarks/matrix --out docs/BENCHMARK-MATRIX.md
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

### Cross-machine benchmark matrix

When you need to support a stronger statement such as "LoggerJS was faster than
pino on every machine we tested," collect multiple local A/B artifacts and
aggregate them:

```bash
pnpm build
pnpm bench:matrix -- --runs=5 --rounds=120 --label="$(hostname)-node22"

# after copying artifacts from other machines into benchmarks/matrix/
pnpm bench:matrix:aggregate -- benchmarks/matrix --out docs/BENCHMARK-MATRIX.md
```

`pnpm bench:matrix` wraps the `BENCH_AB=1 BENCH_JSON=1` harness, runs it several
times, records CPU/OS/Node/dependency/Git metadata, and writes JSON plus
Markdown artifacts under `benchmarks/matrix/` by default. That directory is
ignored because it is local evidence. Commit only an intentionally curated
aggregate such as [BENCHMARK-MATRIX.md](BENCHMARK-MATRIX.md). The checked-in
matrix is the evidence file to cite when making cross-machine performance
statements.

Use the matrix wording carefully: it can prove the listed
machine/runtime/dependency combinations, not a universal result for every
future CPU, Node/V8 version, or pino release.

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

Reference machine: **Apple M1 Max (64 GB), Node v22.21.1**, pino 10.3.1,
winston 3.19.0, LogTape 2.1.3. The loggerjs-vs-pino rows come from the
drift-canceling paired A/B harness (`BENCH_AB`, 22 runs x 120 rounds); the
broader landscape is a single `BENCH_ITERATIONS=1000000` sequential run.

### Cross-logger comparison (paired A/B — the trustworthy method)

Each round times pino, lean, and prepared back-to-back, so CPU frequency and
core scheduling hit them equally and cancel in the ratio (see the `BENCH_AB`
note above). Medians over 22 runs:

| Path | ns/op | vs pino |
| --- | ---: | --- |
| pino ndjson noop sink | 287 | 1.00x baseline |
| loggerjs lean record sink | 242 | **1.19x pino** (paired ratio 0.84, range 0.82-0.87) |
| loggerjs prepared lean record sink | 224 | **1.28x pino** (paired ratio 0.78) |

On this machine loggerjs lean and prepared are **faster than pino** for
equivalent output, reproducibly: the paired lean/pino ratio stayed 0.84 +/- 0.02
across all 22 runs, and held even on rounds where a GC pause pushed the absolute
spread past 80%. The prepared encoder is ~8% faster than plain lean.

**This ranking is environment-dependent.** pino's serializer is generated at
runtime (`new Function`), so its throughput swings widely with CPU and Node/V8
version; loggerjs's static serialization stayed ~242 ns across the machines we
tested while pino ranged ~205-310 ns. On a different chip pino can come out
ahead. Always reproduce on your own hardware: `BENCH_AB=1 pnpm bench:node`.

### Sequential suite (single 1,000,000-iteration run, same machine)

Absolute per-scenario throughput. Cross-logger ratios here are **not** reliable
(each logger is timed at a different point in the run) — use the A/B table above
for loggerjs-vs-pino. This table is for the order-of-magnitude landscape and the
codec paths.

| Scenario | ns/op |
| --- | ---: |
| loggerjs disabled debug (lazy message) | 3 |
| pino disabled debug | 9 |
| loggerjs batch transport enqueue | 172 |
| loggerjs prepared lean record sink | 252 |
| loggerjs lean record sink | 273 |
| loggerjs full-envelope record sink (`+id/seq/levelName`) | 307 |
| loggerjs ndjson event sink | 812 |
| loggerjs fast-event-json event sink | 897 |
| node console info noop stream | 769 |
| winston json noop sink | 2,726 |
| logtape json lines noop sink | 6,584 |

All loggerjs and pino full-path loggers carry the same base fields
(`service`, `env`). The lean sink uses
`fastEventJsonCodec({ includeId: false, includeSeq: false, includeLevelName: false })`;
the prepared lean sink wraps it with `createPreparedRecordEncoder(codec)` to
reuse codec-owned logger/tags fragments without moving serialization into the
logger; the full-envelope sink additionally emits `id`, `seq`, and `levelName`.
The CI-enforced figure is the **ratio** in `pnpm bench:gate` (100k baseline,
gates both plain and prepared lean paths).

Honest read:

- Disabled-level logging is at parity with pino (both single-digit ns).
- For equivalent lean output, loggerjs is **faster than pino on the M1 Max
  reference machine** (paired A/B, lean 1.19x / prepared 1.28x) — but the
  ranking is CPU/V8-dependent, so treat it as "in pino's class, machine-
  dependent winner," not a universal claim. The prepared encoder adds ~8%.
- The full-envelope path costs ~13% more than lean to carry `id`, `seq`, and
  `levelName`; choose the lean envelope when downstream does not need them.
- loggerjs is roughly an order of magnitude faster than winston (~10x) and
  LogTape (~24x), and ~3x faster than Node console; these multiples swing with
  system load, so treat them as approximate.
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
BENCH_BROWSER_IDB_ITERATIONS=5000 pnpm bench:browser
```

## Browser Scenarios

`pnpm bench:browser` runs in a local headless Chrome and measures browser-facing
paths from the built `dist` packages:

- Enabled browser logger with no transports.
- Browser HTTP transport enqueue with a no-op `fetchFn`.
- IndexedDB transport enqueue into the in-memory transport buffer.
- JSON and fast event JSON encoding for browser batches.
- IndexedDB transport flush of a persisted batch.
- IndexedDB HTTP offline queue enqueue.

The IndexedDB scenarios use a separate iteration count because they exercise
real browser storage I/O. Tune it with `BENCH_BROWSER_IDB_ITERATIONS`; the
default is intentionally smaller than `BENCH_BROWSER_ITERATIONS` so routine
browser benchmark runs remain fast. Browser storage numbers are sensitive to
Chrome version, profile state, device storage, private browsing policy, quota,
and Storage Buckets support, so cite them only with the measured browser and
hardware context.

## Size Budgets

`pnpm size:check` runs after build and enforces raw plus gzip budgets for each package entry bundle. Budgets are stored in `scripts/check-size-budgets.mjs` and should be updated only with an intentional public surface or implementation-size change.
