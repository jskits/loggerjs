# LoggerJS Benchmark Matrix

Last updated: 2026-09-30

This table aggregates artifacts produced by `pnpm bench:matrix`. Ratios are paired per-round latency medians from the interleaved A/B harness, not one-off sequential-run ratios. A ratio below `1.00x` means the LoggerJS path had lower latency than pino on that machine; the percentage in parentheses is LoggerJS throughput relative to pino.

The Apple Silicon rows disagree: LoggerJS is faster on the M1 Max and pino is faster on the M4 Pro. The two GitHub-hosted Linux x64 rows (Node 22 and Node 24, shared runners) have LoggerJS lean and prepared ahead of pino. The ranking is CPU/V8-dependent and shared-runner rows are noisy (baseline spread up to 115%), so the matrix still does not support a universal "faster than pino" claim.

| Label | Platform | CPU | Node | LoggerJS | Runs | Pino ns | Lean ns | Prepared ns | Lean / pino | Prepared / pino | Result |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| macbookpro-node22 | darwin/arm64 | Apple M1 Max | v22.21.1 | 0.3.1 | 5 | 286 | 244 | 223 | 0.843x (118.6%) | 0.773x (129.3%) | LoggerJS lean + prepared faster |
| m4pro-node22 | darwin/arm64 | Apple M4 Pro | v22.22.2 | 0.5.1 | 6 | 197 | 223 | 211 | 1.137x (87.9%) | 1.054x (94.9%) | pino faster in this row |
| github-ubuntu-x64-node22 | linux/x64 | AMD EPYC 9V45 96-Core Processor | v22.23.2 | 0.6.0 | 5 | 240 | 218 | 194 | 0.902x (110.9%) | 0.810x (123.4%) | LoggerJS lean + prepared faster |
| github-ubuntu-x64-node24 | linux/x64 | AMD EPYC 7763 64-Core Processor | v24.21.0 | 0.6.0 | 5 | 495 | 489 | 429 | 0.968x (103.4%) | 0.865x (115.6%) | LoggerJS lean + prepared faster |

## Row Details

| Label | Memory | Dependencies | Sampling | Baseline spread | Prepared / lean |
| --- | ---: | --- | --- | ---: | ---: |
| macbookpro-node22 | 64 GB | pino 10.3.1, winston 3.19.0, LogTape 2.1.3 | 5 runs, 120 rounds x 5000 ops, 100000 warmup | 21.2% | 0.919x (108.8%) |
| m4pro-node22 | 24 GB | pino 10.3.1, winston 3.19.0, LogTape 2.1.5 | 6 runs, 120 rounds x 5000 ops, 100000 warmup | 41.9% | 0.942x (106.1%) |
| github-ubuntu-x64-node22 | 15.6 GB | pino 10.3.1, winston 3.19.0, LogTape 2.1.5 | 5 runs, 120 rounds x 5000 ops, 100000 warmup | 115.2% | 0.854x (117.1%) |
| github-ubuntu-x64-node24 | 15.6 GB | pino 10.3.1, winston 3.19.0, LogTape 2.1.5 | 5 runs, 120 rounds x 5000 ops, 100000 warmup | 70.0% | 0.887x (112.7%) |

## Evidence Coverage

| Requirement | Status | Rows |
| --- | --- | --- |
| At least one non-Apple-Silicon runtime | Covered | linux/x64 |
| At least two Node major versions | Covered | 22, 24 |

Both requirements are now covered by the GitHub-hosted Linux rows. The Node 20.19.0 row is still missing: the workflow failed that job before benchmarking because pnpm 11 needs Node >=22.13; the workflow now installs on Node 22 and runs the benchmark on the matrix Node, so the next dispatch collects it.

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
