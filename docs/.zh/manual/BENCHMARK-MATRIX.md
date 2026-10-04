# LoggerJS 基准矩阵

最后更新：2026-10-04

本表汇总 `pnpm bench:matrix` 产出的基准产物。比值取自交错 A/B 测试框架的逐轮配对延迟中位数，而不是单次顺序运行得出的比值。比值低于 `1.00x` 表示在该机器上 LoggerJS 路径的延迟低于 pino；括号中的百分比是 LoggerJS 相对 pino 的吞吐量。

两行 Apple Silicon 结果方向相反：M1 Max 上 LoggerJS 更快，M4 Pro 上 pino 更快。三行 GitHub 托管的 Linux x64 结果使用同一型号的 CPU（AMD EPYC 7763），分别对应 Node 20、22 和 24：prepared 路径在三行中都快于 pino，lean 路径在 Node 22 和 24 上快于 pino，在 Node 20 上慢于 pino。排名取决于 CPU 和 V8 版本，而且共享 runner 的数据噪声较大（基线离散度最高达 91%），因此这份矩阵不支持“普遍快于 pino”的说法。

| Label | Platform | CPU | Node | LoggerJS | Runs | Pino ns | Lean ns | Prepared ns | Lean / pino | Prepared / pino | Result |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| macbookpro-node22 | darwin/arm64 | Apple M1 Max | v22.21.1 | 0.3.1 | 5 | 286 | 244 | 223 | 0.843x (118.6%) | 0.773x (129.3%) | LoggerJS lean + prepared faster |
| m4pro-node22 | darwin/arm64 | Apple M4 Pro | v22.22.2 | 0.5.1 | 6 | 197 | 223 | 211 | 1.137x (87.9%) | 1.054x (94.9%) | pino faster in this row |
| github-ubuntu-x64-node20.19.0 | linux/x64 | AMD EPYC 7763 64-Core Processor | v20.19.0 | 0.6.0 | 5 | 469 | 494 | 443 | 1.064x (94.0%) | 0.945x (105.8%) | LoggerJS prepared faster |
| github-ubuntu-x64-node22 | linux/x64 | AMD EPYC 7763 64-Core Processor | v22.23.3 | 0.6.0 | 5 | 511 | 483 | 423 | 0.956x (104.6%) | 0.845x (118.4%) | LoggerJS lean + prepared faster |
| github-ubuntu-x64-node24 | linux/x64 | AMD EPYC 7763 64-Core Processor | v24.21.0 | 0.6.0 | 5 | 508 | 485 | 427 | 0.961x (104.0%) | 0.873x (114.5%) | LoggerJS lean + prepared faster |

## 行详情

| Label | Memory | Dependencies | Sampling | Baseline spread | Prepared / lean |
| --- | ---: | --- | --- | ---: | ---: |
| macbookpro-node22 | 64 GB | pino 10.3.1, winston 3.19.0, LogTape 2.1.3 | 5 runs, 120 rounds x 5000 ops, 100000 warmup | 21.2% | 0.919x (108.8%) |
| m4pro-node22 | 24 GB | pino 10.3.1, winston 3.19.0, LogTape 2.1.5 | 6 runs, 120 rounds x 5000 ops, 100000 warmup | 41.9% | 0.942x (106.1%) |
| github-ubuntu-x64-node20.19.0 | 15.6 GB | pino 10.3.1, winston 3.19.0, LogTape 2.1.5 | 5 runs, 120 rounds x 5000 ops, 100000 warmup | 32.3% | 0.906x (110.4%) |
| github-ubuntu-x64-node22 | 15.6 GB | pino 10.3.1, winston 3.19.0, LogTape 2.1.5 | 5 runs, 120 rounds x 5000 ops, 100000 warmup | 71.5% | 0.878x (113.9%) |
| github-ubuntu-x64-node24 | 15.6 GB | pino 10.3.1, winston 3.19.0, LogTape 2.1.5 | 5 runs, 120 rounds x 5000 ops, 100000 warmup | 91.3% | 0.890x (112.4%) |

## 证据覆盖

| 要求 | 状态 | 已有行 |
| --- | --- | --- |
| 至少一个非 Apple Silicon 运行环境 | 已覆盖 | linux/x64 |
| 至少两个 Node 主版本 | 已覆盖 | 20, 22, 24 |

这两项要求都由 GitHub 托管的 Linux 行覆盖，它们来自同一次 Benchmark Matrix 运行、同一型号的 CPU。

说明：

- 矩阵只证明表中列出的机器与运行环境组合，不要据此声称“总是快于 pino”。
- README 和基准文档中的措辞应限定在已覆盖的行内。只要上面任一证据要求仍缺失，就把数字描述为参考机器结果。
- LoggerJS 版本后的 `*` 表示该产物是在有本地改动的工作区中采集的。
- 复现某一行：

```bash
pnpm build
pnpm bench:matrix -- --runs=5 --rounds=120 --label="<machine-node>"
```

## 添加新行

每台机器的 JSON 产物写入被 git 忽略的 `benchmarks/matrix/` 目录。要汇总多台机器的结果，把它们的产物复制到该目录后运行：

```bash
pnpm bench:matrix:aggregate -- benchmarks/matrix --out docs/BENCHMARK-MATRIX.md
```

需要非 Apple Silicon 和多 Node 版本的证据时，手动触发 GitHub Actions workflow：

```bash
gh workflow run benchmark-matrix.yml -f runs=5 -f rounds=120 -f batch=5000 -f warmup=100000
```

下载 `benchmark-matrix-aggregate` 产物，检查生成的 `benchmark-matrix-ci.md`，只有当其中的行来自预期的机器与运行环境组合时，才合并进本文件。每一行都必须来自 `pnpm bench:matrix` 产物，不要手工填写数字。
