# LoggerJS Benchmark Matrix

Generated: 2026-06-14T05:36:18.303Z

This table is the checked-in evidence matrix for loggerjs-vs-pino Node hot-path
claims. Ratios are paired per-round latency medians from the interleaved A/B
harness, not one-off sequential-run ratios. A ratio below `1.00x` means the
LoggerJS path had lower latency than pino on that machine.

| Label             | Platform     | CPU          | Node     | Git          | Runs | Pino ns | Lean ns | Prepared ns |     Lean / pino | Prepared / pino | Result                          |
| ----------------- | ------------ | ------------ | -------- | ------------ | ---: | ------: | ------: | ----------: | --------------: | --------------: | ------------------------------- |
| macbookpro-node22 | darwin/arm64 | Apple M1 Max | v22.21.1 | 5d7e4e3bf423 |    5 |     286 |     244 |         223 | 0.843x (118.6%) | 0.773x (129.3%) | LoggerJS lean + prepared faster |

## Row Details

| Label             | Memory | Dependencies                               | Sampling                                     | Baseline spread | Prepared / lean |
| ----------------- | -----: | ------------------------------------------ | -------------------------------------------- | --------------: | --------------: |
| macbookpro-node22 |  64 GB | pino 10.3.1, winston 3.19.0, LogTape 2.1.3 | 5 runs, 120 rounds x 5000 ops, 100000 warmup |           21.2% | 0.919x (108.8%) |

## Reproduce

```bash
pnpm build
pnpm bench:matrix -- --runs=5 --rounds=120 --label="$(hostname)-node22"

# after copying artifacts from other machines into benchmarks/matrix/
pnpm bench:matrix:aggregate -- benchmarks/matrix --out docs/BENCHMARK-MATRIX.md
```

Notes:

- The matrix proves only the listed machine/runtime/dependency combinations. Do
  not turn it into a universal "always faster than pino" claim.
- Add new rows when testing new CPUs, operating systems, Node/V8 versions, or
  pino releases.
- If a row is captured from a dirty worktree, mark the Git column with `*`.
