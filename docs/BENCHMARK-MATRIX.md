# LoggerJS Benchmark Matrix

Last updated: 2026-06-18

This table aggregates artifacts produced by `pnpm bench:matrix`.
Ratios are paired per-round latency medians from the interleaved A/B harness,
not one-off sequential-run ratios. A ratio below `1.00x` means the LoggerJS
path had lower latency than pino on that machine; the percentage in parentheses
is LoggerJS throughput relative to pino.

The two rows disagree: LoggerJS is faster on the M1 Max and pino is faster on
the M4 Pro. The ranking is CPU/V8-dependent, so the matrix does not support a
universal "faster than pino" claim.

| Label | Platform | CPU | Node | LoggerJS | Runs | Pino ns | Lean ns | Prepared ns | Lean / pino | Prepared / pino | Result |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| macbookpro-node22 | darwin/arm64 | Apple M1 Max | v22.21.1 | 0.3.1 | 5 | 286 | 244 | 223 | 0.843x (118.6%) | 0.773x (129.3%) | LoggerJS lean + prepared faster |
| m4pro-node22 | darwin/arm64 | Apple M4 Pro | v22.22.2 | 0.5.1 | 6 | 197 | 223 | 211 | 1.137x (87.9%) | 1.054x (94.9%) | pino faster in this row |

## Row Details

| Label | Memory | Dependencies | Sampling | Baseline spread | Prepared / lean |
| --- | ---: | --- | --- | ---: | ---: |
| macbookpro-node22 | 64 GB | pino 10.3.1, winston 3.19.0, LogTape 2.1.3 | 5 runs, 120 rounds x 5000 ops, 100000 warmup | 21.2% | 0.919x (108.8%) |
| m4pro-node22 | 24 GB | pino 10.3.1, winston 3.19.0, LogTape 2.1.5 | 6 runs, 120 rounds x 5000 ops, 100000 warmup | 41.9% | 0.942x (106.1%) |

## Evidence Coverage

| Requirement | Status | Rows |
| --- | --- | --- |
| At least one non-Apple-Silicon runtime | Missing | darwin/arm64 |
| At least two Node major versions | Missing | 22 |

Both rows are Apple Silicon on Node 22, so neither requirement is covered yet.
Within that one OS/arch/Node major, changing only the CPU (M1 Max to M4 Pro)
flips the result. Until non-Apple and second-Node-major rows exist, describe
these numbers as reference-machine results.

Notes:

- The matrix proves only the listed machine/runtime combinations. Do not turn
  it into a universal "always faster than pino" claim.
- Keep README/BENCHMARKS wording scoped to the covered rows. If either evidence
  requirement above is missing, describe the numbers as reference-machine
  results.
- A `*` after the LoggerJS version means the artifact was captured from a
  working tree with local changes.
- Reproduce a row with:

```bash
pnpm build
pnpm bench:matrix -- --runs=5 --rounds=120 --label="<machine-node>"
```

## Adding Rows

Per-machine JSON artifacts are written to the gitignored `benchmarks/matrix/`
directory. To aggregate rows from several machines, copy their artifacts into
that directory and run:

```bash
pnpm bench:matrix:aggregate -- benchmarks/matrix --out docs/BENCHMARK-MATRIX.md
```

For non-Apple-Silicon and multi-Node evidence, run the manual GitHub Actions
workflow:

```bash
gh workflow run benchmark-matrix.yml -f runs=5 -f rounds=120 -f batch=5000 -f warmup=100000
```

Download the `benchmark-matrix-aggregate` artifact, review the generated
`benchmark-matrix-ci.md`, and merge its rows into this file only if they come
from the intended machine/runtime combinations. Every row must come from a
`pnpm bench:matrix` artifact; do not type in numbers by hand.
