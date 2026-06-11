# Benchmarks

LoggerJS benchmarks are intentionally simple and reproducible. They measure public package builds from `dist`, not TypeScript source.

## Commands

```bash
pnpm bench
pnpm bench:node
pnpm bench:browser
pnpm size:check
```

`pnpm bench` builds the workspace first, then runs Node and browser benchmarks. Browser benchmarks use a local headless Chrome binary. Set `CHROME_BIN` when Chrome is not installed in a standard location.

## Node Scenarios

- Disabled debug log with a lazy message.
- Enabled logger with no transports.
- Enabled logger with a no-op transport.
- Enabled logger with a record-aware no-op write transport (record fast path, no event projection).
- Console transport with a no-op patched console.
- Batch transport enqueue path.
- Full-path NDJSON comparison against pino and winston (see below).
- JSON, safe JSON, fast event JSON, and msgpack adapter encode/decode.
- Fast event JSON encoding raw LogRecord batches (record transport boundary).

## Competitor Comparison

The full-path scenarios log one structured info call per iteration and hand the
serialized line to a discarding sink, so they compare pipeline plus
serialization without I/O noise. pino and winston are dev dependencies pinned
in the root lockfile.

Snapshot recorded 2026-06-12 on an Apple Silicon laptop, Node v22.22.2,
pino 10.3.1, winston 3.19.0, `BENCH_ITERATIONS=200000`:

| Scenario | ns/op | ops/sec |
| --- | ---: | ---: |
| loggerjs disabled debug (lazy message) | 5 | 203,605,445 |
| pino disabled debug | 6 | 162,519,045 |
| loggerjs fast-event-json record sink | 809 | 1,236,233 |
| loggerjs fast-event-json event sink | 848 | 1,178,711 |
| loggerjs ndjson event sink | 1,256 | 796,032 |
| pino ndjson noop sink | 240 | 4,159,928 |
| winston json noop sink | 2,383 | 419,708 |

Honest read of the numbers against the design targets:

- Disabled-level logging is at parity with pino. The target of a one-compare
  early return holds.
- The best loggerjs full path (record sink) runs at roughly 30% of pino
  throughput. The design target of at least 80% of pino is **not met yet**.
  The remaining gap is split between the pipeline (~200ns before any
  transport: record allocation, context merge, normalization) and single-event
  serialization (~600ns vs pino's precompiled stringifier).
- loggerjs is roughly 3x faster than winston on the same path.

Re-run `pnpm bench:node` after hot-path changes and update this snapshot when
the numbers move materially.

Tune iteration counts with:

```bash
BENCH_ITERATIONS=200000 pnpm bench:node
BENCH_BROWSER_ITERATIONS=100000 pnpm bench:browser
```

## Size Budgets

`pnpm size:check` runs after build and enforces raw plus gzip budgets for each package entry bundle. Budgets are stored in `scripts/check-size-budgets.mjs` and should be updated only with an intentional public surface or implementation-size change.
