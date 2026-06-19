# 性能指南

本页是面向用户的性能说明，与 [基准](BENCHMARKS.md)（测量数字）、[基准矩阵](BENCHMARK-MATRIX.md)（签入的机器证据）和 [架构](ARCHITECTURE.md) 的性能预算部分（目标和决策）配套。它说明如何按吞吐量配置 LoggerJS，以及哪些习惯能让 hot path 保持 hot。

参考数字（Apple M1 Max，Node v22.21.1；方法见 [基准](BENCHMARKS.md)，签入行见 [基准矩阵](BENCHMARK-MATRIX.md)）。loggerjs-vs-pino 数字来自 paired A/B harness；相对 pino 的排序依赖 CPU/Node-V8，请用 `BENCH_AB=1 pnpm bench:node` 复现：

| Path | Cost |
| --- | ---: |
| Disabled level call | ~3 ns（pino parity） |
| Enabled pipeline, record fast path, noop sink | ~83 ns |
| Batch transport enqueue（默认设置） | ~172 ns |
| Prepared lean NDJSON line to a sink | ~224 ns（1.28x pino） |
| Lean NDJSON line to a sink | ~242 ns（1.19x pino） |
| Full NDJSON line with id/seq/levelName | ~307 ns |

## 免费收益（默认已经这样做）

- **Disabled levels 只花一次比较。** 保留代码里的 `trace`/`debug` 调用，用 `level` gate。
- **Lazy messages** 只在级别启用时求值，且最多一次：`logger.debug(() => expensive())`。
- **Logger tags 冻结并跨 records 共享**，没有 per-call copy。
- **Default ids** 会按毫秒 memoize timestamp segment。
- **Batch byte estimation** 只有设置有限 `maxBytes` 时才执行。
- **`ndjsonCodec` 默认走 native fast path**，并为会抛错的输入提供 safe fallback。

## Record Fast Path

这是最大的配置杠杆。当 logger 有 **零 processors**，且 transports 是 **record-aware**（`write`/`writeBatch`）时，不会构建 `LogEvent`：没有 id factory、没有 message-error projection、没有第二个对象。

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

- 当 middleware variants 和 processor twins 同时存在时，优先使用 `tagsMiddleware`、`enrichMiddleware`、`traceContextMiddleware` 等 middleware 版本。
- Processors 对 event-shape 行为仍是正确工具（routing、fingerprinting、fingers-crossed）。需要它们时接受 projection 成本：大约 100ns，不是灾难。

## Codec 选择

- 最高吞吐：`@loggerjs/codecs` 的 `fastEventJsonCodec()`；下游不需要 `id`/`seq`/`levelName` 时可使用 lean envelope。
- `ndjsonCodec()`（stdout 默认）在 event path 上与 fast-event-json 差距约 10%。
- Prepared record encoders 适合自定义 sinks。Record-aware transport 直接写 codec 时，用 `createPreparedRecordEncoder(codec)` 包装一次，让 codec-owned logger/tag fragments 可复用，而不把 serialization 移入 logger。
- `safeJsonCodec()` 每条日志都付完整 normalization walk；把它用于经常有 hostile payloads 的场景，而不是最高吞吐路径。
- 自定义 `idFactory`（UUID 等）会付 per-log 成本；默认 id 接近免费且可排序。

## 远程目的地的 Batching

Per-event network calls 是现实中的主要成本；这里每个 remote transport 都基于 `batchTransport`：

- `maxRecords` / `maxWaitMs` 在 latency 和 batch size 间取舍；默认（50 / 2000ms）适合大多数服务。
- 只有目的地强制 payload limits 时才设置 `maxBytes`，因为启用它会打开 per-log byte estimation。
- `concurrency: 2..4` 可重叠慢 endpoint round trips。
- 观察 `getLoggerMetaStats()` 中的 `transport.dropped.*`；drops 表示 queue bound 与流量不匹配。

## 会伤害性能的习惯

- **Middleware/processors 中的重同步工作。** 管线设计为同步；1ms enrichment 会让每条日志多 1ms。
- **在管线中提前 stringify。** 序列化属于 transport codec；字符串 blob 也会破坏 redaction。
- **所有日志都走一个共享 catch-all logger 并挂很多 processors**，但只有一条 route 需要它们。按目的拆分 loggers；children 很便宜。
- **无界 data payloads。** 编码成本与 payload size 成正比；记录 identifiers，不要记录整块实体。

## Import Boundaries

Root `@loggerjs/browser` 和 `@loggerjs/node` 入口是 preset-style convenience imports：它们 re-export core 加所有第一方 runtime transports 和 integrations。当应用简洁性比最小 module graph 更重要时使用它们。

更小 bundle 使用文档化 subpaths。Browser 和 Node subpaths 构建为真实物理 entry bundles，并由 `pnpm verify:entry-boundaries` 验证，因此 focused import 不会指回 aggregate `dist/index`：

```ts
import { browserHttpTransport } from "@loggerjs/browser/transport-http";
import { captureFetchIntegration } from "@loggerjs/browser/integration-fetch";
import { stdoutTransport } from "@loggerjs/node/transport-stdout";
```

新增 runtime-specific feature 且不属于 common preset path 时，应放在 subpath entry 后面。如果新功能让 root browser/node bundle 变大，size-budget diff 应解释为什么 preset entry 需要它。

## 护栏

性能在 CI 中有门禁：`pnpm bench:gate` 运行 interleaved A/B suites，并用与匹配 pino baseline 的 paired ratios 强制限制（见 BENCHMARKS.md）。贡献 hot path 变更时本地运行；结构性回归会让 pull request 失败。

优化的有意终态记录在 ARCHITECTURE.md：保留共享 `LogRecord` 管线作为默认架构，但允许 codec/transport-owned preparation 复用稳定片段。绕过 record 的 fusion paths 仍不作为默认方案，因为它们会制造独立语义 hot path。
