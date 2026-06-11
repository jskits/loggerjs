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
- JSON, safe JSON, fast event JSON, and msgpack adapter encode/decode.
- Fast event JSON encoding raw LogRecord batches (record transport boundary).

## Competitor Comparison

The full-path scenarios log one structured info call per iteration and hand the
serialized line to a discarding sink, so they compare pipeline plus
serialization without terminal or filesystem I/O noise. pino, winston, and
LogTape are dev dependencies pinned in the root lockfile. The Node console
scenario uses a real `Console` instance backed by a discarding stream.

Snapshot recorded 2026-06-12 on an Apple Silicon laptop, Node v22.22.2,
pino 10.3.1, winston 3.19.0, LogTape 2.1.3, `BENCH_ITERATIONS=200000`:

| Scenario | ns/op | ops/sec |
| --- | ---: | ---: |
| loggerjs disabled debug (lazy message) | 5 | 199,766,872 |
| pino disabled debug | 6 | 157,723,607 |
| loggerjs batch transport enqueue | 163 | 6,145,156 |
| loggerjs lean record sink | 268 | 3,735,859 |
| loggerjs fast-event-json record sink | 303 | 3,299,801 |
| loggerjs ndjson event sink | 793 | 1,260,769 |
| loggerjs fast-event-json event sink | 870 | 1,150,046 |
| pino ndjson noop sink | 228 | 4,393,343 |
| node console info noop stream | 549 | 1,821,547 |
| winston json noop sink | 2,436 | 410,525 |
| logtape json lines noop sink | 4,842 | 206,535 |

All loggerjs and pino full-path loggers carry the same base fields
(`service`, `env`). The lean record sink uses
`fastEventJsonCodec({ includeId: false, includeSeq: false, includeLevelName: false })`
to emit pino-shaped lines; the full-envelope record sink additionally emits
`id`, `seq`, and `levelName` per line.

Honest read of the numbers against the design targets:

- Disabled-level logging is at parity with pino.
- The lean record sink runs at roughly 85% of pino, and the full-envelope
  record sink at roughly 75% while carrying three extra fields per line. The
  design target of at least 80% of pino is **met** for equivalent output.
  Full parity is structurally out of reach without giving up the record
  pipeline: pino builds its line directly from call arguments, while loggerjs
  allocates a LogRecord so middleware, processors, and multiple transports can
  observe it.
- loggerjs is roughly 2x faster than Node console, 9x faster than winston, and
  18x faster than LogTape on the measured sink paths.
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
