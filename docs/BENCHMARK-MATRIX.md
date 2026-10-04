# LoggerJS Benchmark Matrix

Last updated: 2026-10-04

This table aggregates artifacts produced by `pnpm bench:matrix`. Ratios are paired per-round latency medians from the interleaved A/B harness, not one-off sequential-run ratios. A ratio below `1.00x` means the LoggerJS path had lower latency than pino on that machine; the percentage in parentheses is LoggerJS throughput relative to pino.

The Apple Silicon rows disagree: LoggerJS is faster on the M1 Max and pino is faster on the M4 Pro. The three GitHub-hosted Linux x64 rows share one CPU model (AMD EPYC 7763) across Node 20, 22, and 24: the prepared path is ahead of pino on all three, and the lean path is ahead on Node 22 and 24 but behind on Node 20. The ranking depends on CPU and V8 version, and shared-runner rows are noisy (baseline spread up to 91%), so the matrix does not support a universal "faster than pino" claim.

| Label | Platform | CPU | Node | LoggerJS | Runs | Pino ns | Lean ns | Prepared ns | Lean / pino | Prepared / pino | Result |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| macbookpro-node22 | darwin/arm64 | Apple M1 Max | v22.21.1 | 0.3.1 | 5 | 286 | 244 | 223 | 0.843x (118.6%) | 0.773x (129.3%) | LoggerJS lean + prepared faster |
| m4pro-node22 | darwin/arm64 | Apple M4 Pro | v22.22.2 | 0.5.1 | 6 | 197 | 223 | 211 | 1.137x (87.9%) | 1.054x (94.9%) | pino faster in this row |
| github-ubuntu-x64-node20.19.0 | linux/x64 | AMD EPYC 7763 64-Core Processor | v20.19.0 | 0.6.0 | 5 | 469 | 494 | 443 | 1.064x (94.0%) | 0.945x (105.8%) | LoggerJS prepared faster |
| github-ubuntu-x64-node22 | linux/x64 | AMD EPYC 7763 64-Core Processor | v22.23.3 | 0.6.0 | 5 | 511 | 483 | 423 | 0.956x (104.6%) | 0.845x (118.4%) | LoggerJS lean + prepared faster |
| github-ubuntu-x64-node24 | linux/x64 | AMD EPYC 7763 64-Core Processor | v24.21.0 | 0.6.0 | 5 | 508 | 485 | 427 | 0.961x (104.0%) | 0.873x (114.5%) | LoggerJS lean + prepared faster |

## Row Details

| Label | Memory | Dependencies | Sampling | Baseline spread | Prepared / lean |
| --- | ---: | --- | --- | ---: | ---: |
| macbookpro-node22 | 64 GB | pino 10.3.1, winston 3.19.0, LogTape 2.1.3 | 5 runs, 120 rounds x 5000 ops, 100000 warmup | 21.2% | 0.919x (108.8%) |
| m4pro-node22 | 24 GB | pino 10.3.1, winston 3.19.0, LogTape 2.1.5 | 6 runs, 120 rounds x 5000 ops, 100000 warmup | 41.9% | 0.942x (106.1%) |
| github-ubuntu-x64-node20.19.0 | 15.6 GB | pino 10.3.1, winston 3.19.0, LogTape 2.1.5 | 5 runs, 120 rounds x 5000 ops, 100000 warmup | 32.3% | 0.906x (110.4%) |
| github-ubuntu-x64-node22 | 15.6 GB | pino 10.3.1, winston 3.19.0, LogTape 2.1.5 | 5 runs, 120 rounds x 5000 ops, 100000 warmup | 71.5% | 0.878x (113.9%) |
| github-ubuntu-x64-node24 | 15.6 GB | pino 10.3.1, winston 3.19.0, LogTape 2.1.5 | 5 runs, 120 rounds x 5000 ops, 100000 warmup | 91.3% | 0.890x (112.4%) |

## Evidence Coverage

| Requirement | Status | Rows |
| --- | --- | --- |
| At least one non-Apple-Silicon runtime | Covered | linux/x64 |
| At least two Node major versions | Covered | 20, 22, 24 |

Both requirements are covered by the GitHub-hosted Linux rows, collected in one Benchmark Matrix run on the same CPU model.

Notes:

- The matrix proves only the listed machine/runtime combinations. Do not turn it into a universal "always faster than pino" claim.
- Keep README/BENCHMARKS wording scoped to the covered rows. If either evidence requirement above is missing, describe the numbers as reference-machine results.
- A `*` after the LoggerJS version means the artifact was captured from a working tree with local changes.
- Reproduce a row with:

```bash
pnpm build
pnpm bench:matrix -- --runs=5 --rounds=120 --label="<machine-node>"
```

## Adding Rows

Per-machine JSON artifacts are written to the gitignored `benchmarks/matrix/` directory. To aggregate rows from several machines, copy their artifacts into that directory and run:

```bash
pnpm bench:matrix:aggregate -- benchmarks/matrix --out docs/BENCHMARK-MATRIX.md
```

For non-Apple-Silicon and multi-Node evidence, run the manual GitHub Actions workflow:

```bash
gh workflow run benchmark-matrix.yml -f runs=5 -f rounds=120 -f batch=5000 -f warmup=100000
```

Download the `benchmark-matrix-aggregate` artifact, review the generated `benchmark-matrix-ci.md`, and merge its rows into this file only if they come from the intended machine/runtime combinations. Every row must come from a `pnpm bench:matrix` artifact; do not type in numbers by hand.
