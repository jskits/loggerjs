# 基准

LoggerJS 的基准测试刻意保持简单、可复现。它们测量的是 `dist` 中构建好的公开包，而不是 TypeScript 源码。

## 命令

```bash
pnpm bench
pnpm bench:node
pnpm bench:browser
pnpm bench:gate
pnpm bench:matrix -- --runs=5 --rounds=120 --label="$(hostname)-node22"
pnpm bench:matrix:aggregate -- benchmarks/matrix --out docs/BENCHMARK-MATRIX.md
pnpm size:check
```

`pnpm bench:gate` 运行交错的 A/B 测试套件，并以与对应 pino 基线逐轮配对的比值作为回归门禁。它使用与 `BENCH_AB` 相同的抵消漂移方法，因此 CPU 频率、调度位置和 GC 暂停会在同一轮中同等地影响每个参测对象。阈值定义在 `scripts/check-bench-regression.mjs` 中，有意设得比较宽松：用来发现结构性回归，而不是噪声。CI 会在每个 pull request 上运行这个门禁。可以通过 `BENCH_GATE_AB_ROUNDS`、`BENCH_GATE_AB_BATCH` 和 `BENCH_GATE_AB_WARMUP` 调整。

`pnpm bench` 会先构建整个 workspace，再运行 Node 和浏览器基准。浏览器基准使用本地的无头 Chrome；如果 Chrome 不在标准位置，请设置 `CHROME_BIN`。

### 公平的跨日志库比值（`BENCH_AB`）

普通套件在一次运行中的不同时间点分别测量每个日志库，因此 loggerjs 与 pino 的比值会随 CPU 频率调节和大小核调度而漂移；单次顺序运行可能仅仅因为“测量时机”不同，就让任一方看起来更好。要公平地比较两个日志库，请使用交错的 A/B 模式：

```bash
BENCH_AB=1 node scripts/bench-node.mjs
# tune: BENCH_AB_ROUNDS (default 60), BENCH_AB_BATCH (5000), BENCH_AB_WARMUP (100000)
BENCH_AB=1 BENCH_JSON=1 node scripts/bench-node.mjs   # machine-readable
```

每一轮都会让所选套件中的参测对象**背靠背**计时，并轮换起始顺序，让漂移同等地影响各方，从而在**逐轮配对比值**中相互抵消。默认套件比较 pino、lean、prepared 和完整信封的 record sink；CI 门禁使用 `BENCH_AB_SUITE=disabled` 和 `BENCH_AB_SUITE=enqueue`。报告会输出每个参测对象的 ns/op，以及比值的中位数和最小/最大范围；当基线的离散度超过 25% 时会发出警告，说明机器负载太不稳定，绝对 ns 数值不可信（比值仍然公平）。引用跨日志库的比值时，只使用这种模式并且基线稳定的数据，不要引用单次顺序运行的结果。

### 跨机器基准矩阵

如果需要支撑更强的说法，例如“在我们测试过的每台机器上 LoggerJS 都快于 pino”，请收集多份本地 A/B 结果并汇总：

```bash
pnpm build
pnpm bench:matrix -- --runs=5 --rounds=120 --label="$(hostname)-node22"

# after copying artifacts from other machines into benchmarks/matrix/
pnpm bench:matrix:aggregate -- benchmarks/matrix --out docs/BENCHMARK-MATRIX.md
```

`pnpm bench:matrix` 封装了 `BENCH_AB=1 BENCH_JSON=1` 测试框架，会运行多次，记录 CPU、操作系统、Node、依赖版本和 Git 等元数据，并默认把 JSON 和 Markdown 结果写到 `benchmarks/matrix/`。该目录被 git 忽略，因为它存放的是本地证据。只提交经过有意整理的汇总结果，例如 [基准矩阵](BENCHMARK-MATRIX.md)。做跨机器的性能表述时，应引用仓库中的这份矩阵。

需要非 Apple Silicon 和多 Node 版本的证据时，手动运行 GitHub Actions workflow `Benchmark Matrix`。它会在 Linux x64 上为 Node 20.19.0、22 和 24 采集数据，并上传汇总的 Markdown 产物供检查。只有在核对过 JSON 产物和 runner 元数据之后，才提交汇总结果。

使用矩阵中的结论时要谨慎：它只能证明表中列出的机器、运行时和依赖组合，不能推广到未来所有的 CPU、Node/V8 版本或 pino 版本。

## Node 场景

- 带延迟消息的禁用 debug 日志。
- 启用但没有 transport 的 logger。
- 启用并使用空操作 transport 的 logger。
- 启用并使用支持 record 的空操作 write transport 的 logger（record 快速路径，不做 event 投影）。
- 使用被 patch 为空操作的 console 的 console transport。
- batch transport 的入队路径。
- 与 pino、winston、LogTape 和 Node console 的完整路径 NDJSON 比较。
- JSON、safe JSON、fast event JSON 和 msgpackr 的编码/解码。
- 用 fast event JSON 编码原始 LogRecord 批次（record transport 边界）。

## 与其他日志库比较

完整路径场景每次迭代记录一条结构化的 info 日志，并把序列化后的行交给一个丢弃输出的 sink，因此比较的是“管线 + 序列化”，不包含终端或文件系统 I/O 的噪声。pino、winston 和 LogTape 是根 lockfile 中固定版本的开发依赖。Node console 场景使用一个真实的 `Console` 实例，底层是丢弃输出的流。

参考机器：**Apple M1 Max（64 GB），Node v22.21.1**，pino 10.3.1、winston 3.19.0、LogTape 2.1.3。loggerjs 与 pino 的对比数据来自抵消漂移的配对 A/B 测试框架（`BENCH_AB`，22 次运行 x 120 轮）；其他日志库的数据来自一次 `BENCH_ITERATIONS=1000000` 的顺序运行。

### 跨日志库比较（配对 A/B，可信的方法）

每一轮都背靠背地测量 pino、lean 和 prepared，因此 CPU 频率和核心调度对它们的影响相同，并在比值中相互抵消。22 次运行的中位数：

| 路径 | ns/op | 相对 pino 的吞吐量 | 配对延迟比值 |
| --- | ---: | --- | --- |
| pino ndjson noop sink | 287 | 1.00x（基线） | 1.00 |
| loggerjs lean record sink | 242 | **1.19x** | 0.84（范围 0.82-0.87） |
| loggerjs prepared lean record sink | 224 | **1.28x** | 0.78 |

在这台机器上，loggerjs 的 lean 和 prepared 路径在等价输出下**快于 pino**，并且结果稳定：22 次运行中 lean/pino 的配对比值都保持在 0.84 +/- 0.02 以内，即使某些轮次的 GC 暂停把绝对值的离散度推到 80% 以上也是如此。prepared 编码器比普通 lean 快约 8%。

**这个排名取决于环境。** pino 和 loggerjs 都使用手工优化的 JSON 热路径，CPU、调度器和 Node/V8 的细微差异都可能改变胜负。上表是所列参考机器上的实测结果，既不是对原理的论断，也不是普遍排名。请始终在自己的硬件上复现：`BENCH_AB=1 pnpm bench:node`，再用 `pnpm bench:matrix` 添加可留存的数据行。

### 顺序套件（同一台机器，单次 1,000,000 次迭代）

各场景的绝对吞吐量。这里的跨日志库比值**不可靠**（各日志库在运行中的不同时间点被测量）；loggerjs 与 pino 的比较请看上面的 A/B 表。本表用于了解数量级和 codec 路径。

| 场景 | ns/op |
| --- | ---: |
| loggerjs disabled debug（lazy message） | 3 |
| pino disabled debug | 9 |
| loggerjs batch transport enqueue | 172 |
| loggerjs prepared lean record sink | 252 |
| loggerjs lean record sink | 273 |
| loggerjs full-envelope record sink（`+id/seq/levelName`） | 307 |
| loggerjs ndjson event sink | 812 |
| loggerjs fast-event-json event sink | 897 |
| node console info noop stream | 769 |
| winston json noop sink | 2,726 |
| logtape json lines noop sink | 6,584 |

所有 loggerjs 和 pino 的完整路径 logger 都带有相同的基础字段（`service`、`env`）。lean sink 使用 `fastEventJsonCodec({ includeId: false, includeSeq: false, includeLevelName: false })`；prepared lean sink 用 `createPreparedRecordEncoder(codec)` 包装它，复用 codec 持有的 logger/tags 片段，而不把序列化挪进 logger；完整信封 sink 额外输出 `id`、`seq` 和 `levelName`。CI 强制执行的是 `pnpm bench:gate` 中的**配对 A/B 比值**（默认每个参测对象 60 轮 x 5000 次操作），覆盖禁用级别日志、record 写入入队、batch 入队，以及 lean、prepared 和完整信封 record sink。

如何解读这些数字：

- 禁用级别的日志与 pino 相当（都是个位数 ns）。
- 在等价的 lean 输出下，loggerjs 在 M1 Max 参考机器上**快于 pino**（配对 A/B，lean 1.19 倍 / prepared 1.28 倍），但排名取决于 CPU 和 V8；应理解为“与 pino 同一量级，胜负因机器而异”，而不是普遍结论。prepared 编码器还能再快约 8%。
- 完整信封路径为了携带 `id`、`seq` 和 `levelName`，比 lean 多约 13% 的开销；下游不需要这些字段时，请使用 lean 信封。
- loggerjs 比 winston 快约一个数量级（约 10 倍），比 LogTape 快约 24 倍，比 Node console 快约 3 倍；这些倍数会随系统负载波动，请作为近似值理解。
- 每个场景的预热次数为其测量迭代次数的四分之一。固定的少量预热（例如 1 万次）会让部分 logger 尚未被 JIT 充分优化，数字可能被放大数倍；因此预热与迭代次数不成比例时，跨 logger 比较无效。

修改热路径后重新运行 `pnpm bench:node`，数字有明显变化时更新快照。

调整迭代次数：

```bash
BENCH_ITERATIONS=200000 pnpm bench:node
BENCH_BROWSER_ITERATIONS=100000 pnpm bench:browser
BENCH_BROWSER_IDB_ITERATIONS=5000 pnpm bench:browser
```

## 浏览器场景

`pnpm bench:browser` 在本地无头 Chrome 中运行，测量构建后的 `dist` 包中面向浏览器的路径：

- 启用但没有 transport 的浏览器 logger。
- 使用空操作 `fetchFn` 的浏览器 HTTP transport 入队。
- IndexedDB transport 入队到内存缓冲区。
- 浏览器批次的 JSON 和 fast event JSON 编码。
- IndexedDB transport flush 一个持久化的批次。
- IndexedDB HTTP 离线队列入队。

IndexedDB 场景使用单独的迭代次数，因为它们会执行真实的浏览器存储 I/O。可以通过 `BENCH_BROWSER_IDB_ITERATIONS` 调整；默认值有意小于 `BENCH_BROWSER_ITERATIONS`，让日常的浏览器基准运行保持较快。浏览器存储的数字对 Chrome 版本、配置文件状态、设备存储、隐私浏览策略、配额和 Storage Buckets 支持都很敏感，引用时必须同时注明测量用的浏览器和硬件。

## 体积预算

`pnpm size:check` 在构建后运行，对每个包入口 bundle 强制执行原始体积和 gzip 体积预算，同时也检查三个经过 tree-shaking 和压缩的最小应用（`createLogger()` 分别搭配 `consoleTransport()`、`browserHttpTransport()` 或 `stdoutTransport()`），它们由 rolldown 基于构建产物打包。预算保存在 `scripts/check-size-budgets.mjs` 中，只有在有意改变公开 API 或实现体积时才应随之更新。
