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
single low-noise run), after the `getContext` fast-path and `fastEventJsonCodec`
encoder specialization. Every ratio below is computed directly from these
numbers as `pino_ns / loggerjs_ns`:

| Scenario | ns/op | ops/sec |
| --- | ---: | ---: |
| loggerjs disabled debug (lazy message) | 2 | 579,794,173 |
| pino disabled debug | 7 | 148,533,234 |
| loggerjs batch transport enqueue | 173 | 5,794,474 |
| loggerjs lean record sink | 267 | 3,739,631 |
| loggerjs fast-event-json record sink | 301 | 3,327,283 |
| loggerjs ndjson event sink | 858 | 1,165,231 |
| loggerjs fast-event-json event sink | 939 | 1,064,471 |
| pino ndjson noop sink | 224 | 4,454,734 |
| node console info noop stream | 698 | 1,432,932 |
| winston json noop sink | 2,723 | 367,302 |
| logtape json lines noop sink | 5,057 | 197,765 |

All loggerjs and pino full-path loggers carry the same base fields
(`service`, `env`). The lean record sink uses
`fastEventJsonCodec({ includeId: false, includeSeq: false, includeLevelName: false })`
to emit lean comparable lines; the full-envelope record sink additionally emits
`id`, `seq`, and `levelName` per line. Absolute ns/op vary run to run (the
disabled path is especially warmup-sensitive, 2-6ns); the CI-enforced figure is
the **ratio** in `pnpm bench:gate`, which uses a 100k baseline and currently
measures lean at ~1.20x pino.

Honest read of the numbers against the design targets:

- Disabled-level logging is at parity with pino (both single-digit ns).
- The lean record sink runs at **~84% of pino** in this snapshot (224/267,
  ≈1.19x; the 100k CI gate measures ~1.20x), and the full-envelope record sink
  at **~74%** (224/301) while carrying three extra fields per line. The design
  target of at least 80% of pino is **met** for equivalent output. The 2026-06
  optimization closed the lean ratio from ~1.30x to ~1.20x by removing a
  per-call context-merge allocation and specializing the encoder; see
  `docs/ARCHITECTURE.md` for what is recoverable code vs. genuine architectural
  cost (the `LogRecord` allocation, the codec's decoupling from the logger, and
  the never-throw safe-fallback contract).
- On this run loggerjs is ~2.6x faster than Node console (698/267), ~10x faster
  than winston (2723/267), and ~19x faster than LogTape (5057/267); these
  competitor multiples swing with system load, so treat them as approximate.
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
