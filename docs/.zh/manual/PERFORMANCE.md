# 性能指南

本页是面向使用者的性能说明，与 [基准](BENCHMARKS.md)（测量数据）、[基准矩阵](BENCHMARK-MATRIX.md)（仓库中的跨机器数据）和 [架构](ARCHITECTURE.md) 的性能部分（目标与决策）互为补充。它介绍如何按吞吐量配置 LoggerJS，以及哪些习惯能让热路径保持高效。

参考数据（Apple M1 Max，Node v22.21.1；方法见 [基准](BENCHMARKS.md)，对应的数据行见 [基准矩阵](BENCHMARK-MATRIX.md)）。loggerjs 与 pino 的对比数据来自配对 A/B 测试框架；相对 pino 的排名取决于 CPU 和 Node/V8 版本，请用 `BENCH_AB=1 pnpm bench:node` 复现：

| 路径 | 开销 |
| --- | ---: |
| 禁用级别的调用 | ~3 ns（与 pino 相当） |
| 启用的管线，record 快速路径，空操作 sink | ~83 ns |
| batch transport 入队（默认设置） | ~172 ns |
| 向 sink 输出一行 prepared lean NDJSON | ~224 ns（pino 的 1.28 倍） |
| 向 sink 输出一行 lean NDJSON | ~242 ns（pino 的 1.19 倍） |
| 输出一行带 id/seq/levelName 的完整 NDJSON | ~307 ns |

## 默认就有的优化

- **禁用的级别只需一次比较。** 可以放心在代码里保留 `trace`/`debug` 调用，用 `level` 控制是否输出。
- **延迟消息**只在级别启用时计算，且最多计算一次：`logger.debug(() => expensive())`。
- **logger 的 tags 被冻结并在 record 之间共享**，每次调用都不会复制。
- **默认 id** 会按毫秒缓存时间戳部分。
- **批量的字节估算**只有在设置了有限的 `maxBytes` 时才会执行。
- **`ndjsonCodec` 默认走原生快速路径**，遇到会让原生序列化抛错的输入时才安全回退。

## Record 快速路径

这是影响最大的配置项。当 logger **没有任何 processor**，且 transport **支持 record**（实现了 `write`/`writeBatch`）时，完全不会构建 `LogEvent`：不调用 id 工厂，不做消息和错误的投影，也不会创建第二个对象。

```ts
// Fast path: middleware + record-aware transport
createLogger({
  middleware: [tagsMiddleware({ service: "checkout" })], // middleware 保留 fast path
  transports: [recordAwareTransport],
});

// 离开 fast path: 任意 processor 都会强制每条日志做 event projection
createLogger({
  processors: [sampleProcessor()],
  transports: [recordAwareTransport],
});
```

实践建议：

- 同一功能既有 middleware 版本又有 processor 版本时，优先使用 middleware 版本，例如 `tagsMiddleware`、`enrichMiddleware`、`traceContextMiddleware`。
- 对依赖 event 结构的行为（路由、指纹、fingers-crossed），processor 仍是正确的选择。需要时接受投影的开销即可：大约 100ns，算不上灾难。

## Codec 选择

- 最高吞吐：`@loggerjs/codecs` 中的 `fastEventJsonCodec()`；下游不需要这些字段时，可以使用 lean 信封（`includeId/includeSeq/includeLevelName: false`）。
- `ndjsonCodec()`（stdout 的默认 codec）在 event 路径上与 fast-event-json 相差约 10%。
- prepared record 编码器适合自定义 sink。当支持 record 的 transport 直接调用 codec 时，用 `createPreparedRecordEncoder(codec)` 包装一次，就能复用 codec 持有的 logger/tag 片段，而不必把序列化挪进 logger。
- `safeJsonCodec()` 对每一条都做完整的规范化遍历；把它用在经常出现异常 payload 的场景，而不是追求吞吐量的路径。
- 自定义 `idFactory`（UUID 等）每条日志都有开销；默认 id 几乎零成本且可排序。

## 远程目的地的批量

逐条发起网络请求是现实中最主要的成本。`nodeHttpTransport()` 和 `otlpHttpTransport()` 内部已用 `batchTransport` 包装，`browserHttpTransport()` 自带批量；Datadog、Elastic、Loki 和 CloudWatch 的原始 transport 需要自行用 `batchTransport()` 包装（见 [传输](TRANSPORTS.md#厂商包)）：

- `maxRecords` / `maxWaitMs` 在延迟和批次大小之间取舍；`batchTransport` 的默认值（50 条 / 1000 毫秒）适合大多数服务。
- 只有目的地限制 payload 大小时才设置 `maxBytes`，因为启用它会对每条日志做字节估算。
- `concurrency: 2..4` 可以让慢端点的多次往返并行进行。
- 关注 `getLoggerMetaStats()` 中的 `transport.dropped.*`；出现丢弃说明队列上限与实际流量不匹配。

## 影响性能的习惯

- **在 middleware/processor 中做繁重的同步工作。** 管线是同步设计的；一次 1ms 的补充字段操作会让每条日志都慢 1ms。
- **在管线中提前序列化。** 序列化属于 transport 的 codec；序列化后的字符串也会让脱敏失效。
- **所有日志都走同一个挂了很多 processor 的通用 logger**，而其实只有一条路由需要它们。按用途拆分 logger，child logger 的成本很低。
- **不设上限的 data payload。** 编码成本与 payload 大小成正比；记录标识符，而不是整个实体。

## 导入边界

`@loggerjs/browser` 和 `@loggerjs/node` 的根入口是预设式的便捷入口：它们重新导出 core 以及所有一方的运行时 transport 和 integration。当应用的简单性比最小的模块图更重要时使用它们。

需要更小的 bundle 时，导入文档中列出的子路径。browser 和 Node 的子路径都构建为独立的物理入口 bundle，并由 `pnpm verify:entry-boundaries` 校验，因此按需导入不会又指回聚合的 `dist/index`：

```ts
import { browserHttpTransport } from "@loggerjs/browser/transport-http";
import { captureFetchIntegration } from "@loggerjs/browser/integration-fetch";
import { stdoutTransport } from "@loggerjs/node/transport-stdout";
```

新增的运行时专有功能如果不属于常用预设路径，应放在单独的子路径入口后面。如果新功能让 browser/node 根入口的 bundle 变大，体积预算的变更说明中应解释预设入口为什么需要它。

## 护栏

性能在 CI 中有门禁：`pnpm bench:gate` 运行交错的 A/B 测试套件，并以与对应 pino 基线的配对比值作为阈值（见 [基准](BENCHMARKS.md)）。修改热路径时请在本地运行；结构性回归会让 pull request 失败。

优化的最终方向记录在 [架构](ARCHITECTURE.md) 中：默认架构保留共享的 `LogRecord` 管线，但允许由 codec/transport 负责的预处理来复用稳定片段。绕过 record 的融合路径仍不作为默认方案，因为它会形成一条独立语义的热路径。
