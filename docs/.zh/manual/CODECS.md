# 编解码

Codec 把日志 records 或 events 转成字节，也可以可选地反向解析。Codecs 属于 **transports**：管线内部保持原始值，让 redaction 和 routing 能处理结构化数据，并让每个目的地选择自己的 wire format。

## 合约

```ts
interface Codec<TPayload = string | Uint8Array> {
  name: string;
  contentType: string;
  encode(input: LogEvent | LogRecord | readonly (LogEvent | LogRecord)[], context?: EncodeContext): TPayload;
  decode?(payload: TPayload): LogEvent | LogEvent[];
  prepareRecordEncoder?(hints: RecordEncoderHints): PreparedRecordEncoder<TPayload>;
}
```

- `encode` 接收单项或批量，接收 events 或 records。core 的 `normalizeCodecInput()` 会把 records 投影成 events，供只理解 events 的 codecs 使用。
- `decode` 是可选的；内置 codecs 用 `JSON.parse` 实现对自身输出的对称 round trip。
- `prepareRecordEncoder` 是可选的。Record-aware transports 可以调用 `createPreparedRecordEncoder(codec)`，让 codec 缓存稳定的 category/tags 片段，同时仍然由 transport 拥有序列化。

## 内置 Codecs

| Codec | Package | 行为 |
| --- | --- | --- |
| `jsonCodec()` | core | 输入标准化后直接 `JSON.stringify`。速度快，但 circular/BigInt 会抛错；只在 payload 保证干净时使用。 |
| `safeJsonCodec(options)` | core | 每次完整安全标准化：circular -> `"[Circular]"`、BigInt -> string、Error -> `{name, message, stack}`、深度/数组/key 截断、Map/Set 转换。`consoleTransport({ pretty: false })` 的默认 codec。 |
| `ndjsonCodec(options)` | core | 每行一个 JSON object。遵守下方的 **fast-by-default 合约**。Node stdout/file transports 的默认 codec。 |
| `fastEventJsonCodec(options)` | `@loggerjs/codecs` | 性能 codec：native fast path、片段缓存（level、logger、tags、time）、扫描式字符串转义、flat-data 直接写入、lean envelope 选项。 |
| `pinoCompatCodec(options)` / `pinoNdjsonProjector(options)` | `@loggerjs/codecs` | 迁移用 Pino 形状 NDJSON：`level`、`time`、可选 `pid`/`hostname` base fields、`msg`、`err`，以及带保留键保护的可选 root data merge。 |
| `msgpackrCodec(options?)` | `@loggerjs/codecs` | 基于 `msgpackr` 的内置 MessagePack codec；返回 `Uint8Array`。仍支持传入 `{ pack, unpack }` 适配自定义 runtime。 |
| `projectorCodec(options)` | `@loggerjs/codecs` | 通用 project -> serialize（-> parse -> unproject）适配器，用于自定义 wire schema。 |
| `otlpJsonCodec(options)` | `@loggerjs/otel` | 带 resource attributes 的 OTLP/HTTP JSON log payload。 |

## Fast-by-Default 合约

`ndjsonCodec()` 和 `fastEventJsonCodec()` 共享同一套文档化行为：

- **不设置任何选项**：encode 走 native fast path。输出遵循原生 `JSON.stringify` 语义：data 中嵌套的原始 `Error` 会序列化为 `{}`，没有深度截断。会让 native stringify *抛错* 的输入（circular references、BigInt）会透明地用 safe stringifier 重新编码；日志行不会因为编码失败而丢失，每次 fallback 都会增加 `codec.fallback` meta counter。
- **设置任何 `SafeStringifyOptions` 字段**（`maxDepth`、`maxArrayLength`、`maxObjectKeys`、`includeStack`、`stable`、`space`）：codec 会对每一项启用完整安全标准化，也会保留 data payload 中 `Error` 的 name/message/stack。

这需要显式选择：native-fast 加 throw-protection，或完整标准化。`safeJsonCodec` 始终是 always-safe。

## Lean Envelope 选项

`fastEventJsonCodec` 可以裁剪 envelope，以获得最小 NDJSON 输出：

```ts
fastEventJsonCodec({
  includeId: false,        // 也会在 record path 上完全跳过 id 计算
  includeSeq: false,
  includeLevelName: false,
  // includeData / includeError / includeContext / includeTrace / includeSource
})
```

关闭三个 header flags 后，输出是 lean LoggerJS envelope：`{"time":...,"level":30,"logger":"api","message":"...","data":{...}}`。这是 [基准](BENCHMARKS.md) 中头条数字使用的配置；record-aware custom transports 可以把它和 `createPreparedRecordEncoder(codec)` 搭配，走最快的稳定片段路径。需要 Pino 字段名（`msg`、`err`、`pid`、`hostname`）时使用 `pinoCompatCodec()`。

## Pino 兼容

`pinoCompatCodec()` 输出 newline-delimited JSON，适合需要 Pino 形状输出的迁移路径：

```ts
import { pinoCompatCodec } from "@loggerjs/codecs";

pinoCompatCodec({
  base: { pid: process.pid, hostname: "api-1" },
  mergeData: true,
});
```

Root data merging 是 opt-in。默认情况下，LoggerJS 把 payload 保留在 `data` 下；启用 `mergeData: true` 后，`time`、`level`、`msg`、`pid`、`hostname`、`err`、`logger`、`data` 等保留键会被嵌套，避免覆盖 transport-owned fields。迁移测试时如果希望拒绝这类 payload，可以设置 `collision: "throw"`。

这个 codec 有意只支持 encode：Pino-shaped NDJSON 是迁移 wire format，不是 LoggerJS 原生 event envelope。

## Records、Events 和 IDs

编码原始 `LogRecord`（fast path）与编码 events 有一个语义差异：records 没有 id，所以 codec 会写入 `defaultRecordId(record, levelName)`，即 `time36-seq36-levelName` 字符串，与 `recordToEvent()` 分配的 id 一致。影响是：

- 使用默认 id factory 时，record-encoded 和 event-encoded 输出完全相同。
- logger 上自定义的 `idFactory` 会被 record-direct encoding **绕过**。如果自定义 id 很重要，transport 应通过 `context.toEvent(record)` 转换（memoized，会应用 id factory），而不是直接编码 record。

## 编写自定义 Codec

```ts
import { normalizeCodecInput, type Codec } from "@loggerjs/core";

export function csvCodec(): Codec<string> {
  return {
    name: "csv",
    contentType: "text/csv",
    encode(input) {
      const events = normalizeCodecInput(input);
      const list = Array.isArray(events) ? events : [events];
      return list
        .map((e) => `${e.time},${e.levelName},${JSON.stringify(e.logger)},${JSON.stringify(e.message)}`)
        .join("\n");
    },
  };
}
```

建议：

- **不要让 `encode` 抛出。** 包住风险路径，并 fallback 到 core 的 `safeJsonStringify`；用 `incrementLoggerMetaCounter("codec.fallback")` 计数。抛错的 codec 会变成 transport failure；在 batch transport 内还会形成消耗 retries 的 poison batch。
- 除非你有意实现 record fast path，否则使用 `normalizeCodecInput()`。
- 如果实现 `prepareRecordEncoder`，同一 record 的输出必须和 `encode(record)` 字节级一致，并保持相同 fallback 行为。
- 二进制格式返回 `Uint8Array`，并设置准确的 `contentType`；HTTP transports 会发送它。
- 只有当你的功能需要对称 round trip（replay、本地查询）时才实现 `decode`；投递不要求它。
