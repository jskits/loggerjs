# LoggerJS 基准矩阵

最后更新：2026-06-18

本表汇总 `pnpm bench:matrix` 产出的基准产物。比值取自交错 A/B 测试框架的逐轮配对延迟中位数，而不是单次顺序运行得出的比值。比值低于 `1.00x` 表示在该机器上 LoggerJS 路径的延迟低于 pino；括号中的百分比是 LoggerJS 相对 pino 的吞吐量。

两行结果方向相反：M1 Max 上 LoggerJS 更快，M4 Pro 上 pino 更快。排名取决于 CPU 和 V8 版本，因此这份矩阵不支持“普遍快于 pino”的说法。

| Label | Platform | CPU | Node | LoggerJS | Runs | Pino ns | Lean ns | Prepared ns | Lean / pino | Prepared / pino | Result |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| macbookpro-node22 | darwin/arm64 | Apple M1 Max | v22.21.1 | 0.3.1 | 5 | 286 | 244 | 223 | 0.843x (118.6%) | 0.773x (129.3%) | LoggerJS lean + prepared faster |
| m4pro-node22 | darwin/arm64 | Apple M4 Pro | v22.22.2 | 0.5.1 | 6 | 197 | 223 | 211 | 1.137x (87.9%) | 1.054x (94.9%) | pino faster in this row |

## 行详情

| Label | Memory | Dependencies | Sampling | Baseline spread | Prepared / lean |
| --- | ---: | --- | --- | ---: | ---: |
| macbookpro-node22 | 64 GB | pino 10.3.1, winston 3.19.0, LogTape 2.1.3 | 5 runs, 120 rounds x 5000 ops, 100000 warmup | 21.2% | 0.919x (108.8%) |
| m4pro-node22 | 24 GB | pino 10.3.1, winston 3.19.0, LogTape 2.1.5 | 6 runs, 120 rounds x 5000 ops, 100000 warmup | 41.9% | 0.942x (106.1%) |

## 证据覆盖

| 要求 | 状态 | 已有行 |
| --- | --- | --- |
| 至少一个非 Apple Silicon 运行环境 | 缺失 | darwin/arm64 |
| 至少两个 Node 主版本 | 缺失 | 22 |

两行都是 Node 22 上的 Apple Silicon，因此两项要求都还没有满足。在同一操作系统、架构和 Node 主版本内，仅把 CPU 从 M1 Max 换成 M4 Pro，结论就会反转。在补齐非 Apple 和第二个 Node 主版本的数据之前，请把这些数字表述为参考机器上的结果。

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
