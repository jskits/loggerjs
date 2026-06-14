# LoggerJS Benchmark Matrix - macbookpro-node22

Generated: 2026-06-14T05:36:18.303Z

| Field        | Value                                        |
| ------------ | -------------------------------------------- |
| Git          | main@5d7e4e3bf423                            |
| Runtime      | v22.21.1, V8 12.4.254.21-node.33             |
| OS           | darwin/arm64 24.6.0                          |
| CPU          | Apple M1 Max (10 logical cores)              |
| Memory       | 64 GB                                        |
| Dependencies | pino 10.3.1, winston 3.19.0, LogTape 2.1.3   |
| Sampling     | 5 runs, 120 rounds x 5000 ops, 100000 warmup |

| Path              | Median ns/op | p25..p75 | Min..max |
| ----------------- | -----------: | -------: | -------: |
| pino ndjson       |          286 | 285..289 | 285..334 |
| loggerjs lean     |          244 | 243..244 | 241..278 |
| loggerjs prepared |          223 | 222..229 | 221..253 |

| Ratio                             | Median latency | Throughput vs baseline | Wins |
| --------------------------------- | -------------: | ---------------------: | ---: |
| loggerjs lean / pino ndjson       |         0.843x |                 118.6% |  5/5 |
| loggerjs prepared / pino ndjson   |         0.773x |                 129.3% |  5/5 |
| loggerjs prepared / loggerjs lean |         0.919x |                 108.8% |  5/5 |

Baseline pino spread across local samples: 21.2%

Interpretation: these are paired A/B ratios for this machine and runtime only.
Use `pnpm bench:matrix:aggregate -- benchmarks/matrix --out docs/BENCHMARK-MATRIX.md`
to combine artifacts from multiple machines into a publishable matrix.
