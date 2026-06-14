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

## Evidence Coverage

| Requirement | Status | Rows |
| --- | --- | --- |
| At least one non-Apple-Silicon runtime | Missing | darwin/arm64 |
| At least two Node major versions | Missing | 22 |

Until those rows are committed, performance wording must stay scoped to the M1
Max / Node 22 reference row above. Do not turn it into a universal "LoggerJS is
always faster than pino" claim.

## Reproduce

```bash
pnpm build
pnpm bench:matrix -- --runs=5 --rounds=120 --label="$(hostname)-node22"

# after copying artifacts from other machines into benchmarks/matrix/
pnpm bench:matrix:aggregate -- benchmarks/matrix --out docs/BENCHMARK-MATRIX.md
```

For non-Apple-Silicon and multi-Node evidence, run the manual GitHub Actions
workflow:

```bash
gh workflow run benchmark-matrix.yml -f runs=5 -f rounds=120 -f batch=5000 -f warmup=100000
```

Download the `benchmark-matrix-aggregate` artifact, review the generated
`benchmark-matrix-ci.md`, and commit it to this file only if the rows are from
the intended machine/runtime combinations. Do not hand-write benchmark rows
without the matching JSON artifacts.

Notes:

- The matrix proves only the listed machine/runtime/dependency combinations. Do
  not turn it into a universal "always faster than pino" claim.
- Add new rows when testing new CPUs, operating systems, Node/V8 versions, or
  pino releases.
- If a row is captured from a dirty worktree, mark the Git column with `*`.
