# LoggerJS Benchmark Matrix

Last updated: 2026-06-18 (two machine rows hand-merged; per-machine JSON
artifacts live in the gitignored `benchmarks/matrix/`, so the aggregate command
cannot regenerate a row whose artifact is not present locally).

This table is the checked-in evidence matrix for loggerjs-vs-pino Node hot-path
claims. Ratios are paired per-round latency medians from the interleaved A/B
harness, not one-off sequential-run ratios. A ratio below `1.00x` means the
LoggerJS path had lower latency than pino on that machine. **The two rows below
deliberately disagree — that is the point:** the ranking is CPU/V8-dependent
(LoggerJS faster on M1 Max, pino faster on M4 Pro), so no universal "faster than
pino" claim is supportable.

| Label             | Platform     | CPU          | Node     | Git          | Runs | Pino ns | Lean ns | Prepared ns |     Lean / pino | Prepared / pino | Result                          |
| ----------------- | ------------ | ------------ | -------- | ------------ | ---: | ------: | ------: | ----------: | --------------: | --------------: | ------------------------------- |
| macbookpro-node22 | darwin/arm64 | Apple M1 Max | v22.21.1 | 5d7e4e3bf423 |    5 |     286 |     244 |         223 | 0.843x (118.6%) | 0.773x (129.3%) | LoggerJS lean + prepared faster |
| m4pro-node22      | darwin/arm64 | Apple M4 Pro | v22.22.2 | 1d3d51c21f86 |    6 |     197 |     223 |         211 | 1.137x (87.9%)  | 1.054x (94.9%)  | pino faster (lean + prepared)   |

## Row Details

| Label             | Memory | Dependencies                               | Sampling                                     | Baseline spread | Prepared / lean |
| ----------------- | -----: | ------------------------------------------ | -------------------------------------------- | --------------: | --------------: |
| macbookpro-node22 |  64 GB | pino 10.3.1, winston 3.19.0, LogTape 2.1.3 | 5 runs, 120 rounds x 5000 ops, 100000 warmup |           21.2% | 0.919x (108.8%) |
| m4pro-node22      |  24 GB | pino 10.3.1, winston 3.19.0, LogTape 2.1.5 | 6 runs, 120 rounds x 5000 ops, 100000 warmup |           41.9% | 0.942x (106.1%) |

## Evidence Coverage

| Requirement | Status | Rows |
| --- | --- | --- |
| At least one non-Apple-Silicon runtime | Missing | darwin/arm64 |
| At least two Node major versions | Missing | 22 |

Both gates remain **Missing**: the M4 Pro row is a second Apple-Silicon CPU on
Node 22, so it does not satisfy the non-Apple or second-Node-major requirements.
It does, however, already make the universal-claim guard concrete — within the
same OS/arch/Node-major, swapping only the CPU (M1 Max → M4 Pro) flips the
result from "LoggerJS faster" to "pino faster". Until a non-Apple and a second
Node-major row are added, keep performance wording CPU-scoped and never frame it
as "LoggerJS is always faster than pino".

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
