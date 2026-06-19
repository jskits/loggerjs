# 核心概念

LoggerJS 围绕三个面向用户的概念组织：**integrations**、**middleware/processors** 和 **transports**。再加上一条边界规则：**codecs 属于 transports**。本页解释连接这些部分的管线。

## 管线

```text
logger.info("msg", data)
  │
  ├─ level gate            一次数值比较；禁用级别到这里直接停止
  │
  ├─ LogRecord built       lazy message 暂不求值，保留原始 error，
  │                        附加 category/type/tags/context
  │
  ├─ middleware            同步、有序，可以修改或丢弃 record
  │
  ├─ processors?           如果存在任何 processor，record 会投影为
  │   │                    LogEvent（分配 id、解析 message、标准化 error），
  │   │                    然后在 event 上运行 processors
  │   │
  │   └─ no processors:    record 直接进入 transports
  │                        （“record fast path”，没有投影成本）
  │
  └─ transports            每个 transport 接收 record（write/writeBatch）
      │                    或 event（log/logBatch）；转换只发生一次并复用
      │
      └─ codec             transport 用自己的 codec 序列化
```

Integrations 位于这个流程外部：它们 hook 平台行为（console 调用、错误、fetch、process 事件），再通过 `api.capture()` 把捕获到的输入送进同一条管线。

## LogRecord 与 LogEvent

`LogRecord` 是热路径形状。它保留原始值，确保在真正需要之前不做工作：

- `lazy`：尚未求值的消息函数，最多解析一次。
- `err`：原始错误值，尚未标准化。
- `props`：用户数据对象；除非 middleware、processor 或 transport 显式 clone，否则按引用共享。
- `ctx`：冻结的绑定上下文对象，按引用共享。
- `tags`：可能是 logger 的冻结 tags 对象，按引用共享。
- 没有 `id`：id 计算延迟到 event 投影阶段。

`LogEvent` 是面向 transport 的兼容形状：`id`、`time`、`seq`、`level`、`levelName`、`logger`（点分 category）、`message`（解析后的字符串）、`type`、`tags`、`data`、`error`（标准化后的 `SerializedError`）、`context`、`trace`、`source`。

`recordToEvent()` / `eventToRecord()` 可以互相转换。转换存在文档化的信息损失：`runtime` source 会折叠为 integration source，标量 event data 会包装成 `{ value }`。对象 data 默认不会快照；如果后续修改不能影响延迟 transport，请在记录前 clone。

### 修改合约

Middleware 可以修改 record，但有一条规则：**替换字段，不要原地修改共享对象**。`record.ctx` 和 logger 级别的 `record.tags` 是冻结且跨 record 共享的；应写 `record.tags = { ...record.tags, extra }`，不要写 `record.tags.extra = ...`。原地修改冻结字段会抛错，并作为 middleware error 上报，不会污染其他 records。

## Middleware 与 Processors

两者都是同步、有序且错误隔离的。区别在于看到的数据和运行时机：

| | Middleware | Processor |
| --- | --- | --- |
| 输入 | `LogRecord` | `LogEvent` |
| 运行时机 | 在 id/message/error 工作之前 | 在投影之后 |
| 丢弃 | 返回 `null` | 返回 `false` |
| 修改 | 原地修改（替换字段） | 返回新 event |
| 丢弃成本 | 最低 | 已经付过投影成本 |

优先用 middleware 做 enrichment 和早期过滤。需要解析后的 event 形状时再用 processors，例如按 event 字段路由、对标准化错误做 fingerprint、为 fingers-crossed delivery 缓冲 events。

**只要配置了任何 processor，该 logger 的 record fast path 就会关闭**，因为每条日志都必须先投影为 event。当你需要 event 级别行为时，这是正确取舍；数字见 [性能](PERFORMANCE.md)。

## Transports

一个 transport 可以实现以下四类写入方法中的任意组合：

```ts
interface Transport {
  name?: string;
  minLevel?: LoggerLevel;
  ready?(): void | Promise<void>;
  write?(record: LogRecord, context: TransportContext): void | Promise<void>;
  writeBatch?(
    records: LogRecord[],
    context: TransportContext,
  ): void | Promise<void>;
  log?(event: LogEvent, context: TransportContext): void | Promise<void>;
  logBatch?(
    events: LogEvent[],
    context: TransportContext,
  ): void | Promise<void>;
  flush?(): void | Promise<void>;
  flushSync?(): void;
  close?(): void | Promise<void>;
}
```

- 支持 record 的 transports（`write`/`writeBatch`）参与 fast path，并可以直接编码 records。
- Event transports（`log`/`logBatch`）接收投影后的 events。
- `context.toEvent(record)` 按需转换；结果按 record memoize，所以多个 transports 共享一次投影，id 在多次转换间保持稳定。
- transport 抛出的同步或异步错误都会被捕获并上报到 logger meta；一个失败 transport 不会阻塞其他 transport。
- `ready()` 是显式、可选的。普通日志调用不会等待 transport 启动；需要确认启动完成的调用方使用 `logger.ready()`。
- `close()` 必须在释放资源前包含自己的 best-effort flush。Core 在有 `close()` 时调用它；只有 transport 没有 `close()` 时才回退到 `flush()`。

## Codecs 属于 Transports

序列化由 transport 拥有，并通过自己的 codec 配置。Middleware 和 processors 保持原始值，不要在管线内部提前 stringify。这样结构化脱敏仍然有效，每个目的地可以选择自己的 wire format，batching 也可以摊薄序列化成本。

```ts
stdoutTransport({ codec: ndjsonCodec() });
browserHttpTransport({ url: "/api/logs", codec: fastEventJsonCodec() });
```

合约和 fast-by-default 安全语义见 [编解码](CODECS.md)。

## Integrations

Integration 是一个具名的 `setup(api)` 函数，负责 hook 平台表面并返回 teardown：

```ts
interface Integration {
  name: string;
  setup(api: IntegrationSetupContext): void | Teardown;
}
```

setup context 提供 logging API 和三个安全工具：

- `api.capture(input)`：把捕获信号送入管线，并标记 `source: "integration:<name>"`。
- `api.guard(fn)`：重入保护。如果 patched 代码路径调用 logger，而 logger 又调用到 patched 代码，内层调用会被丢弃并计数，避免无限循环。
- `api.unpatched`：原始函数注册表（`console.*`、`fetch`、`XMLHttpRequest`），让 transports 和 integrations 在 patch 存在时仍能调用真实实现。

Integrations 会在 logger 构造时或 `addIntegration()` 时安装；每个 integration instance 只 setup 一次，并在 `close()` 时按反向顺序 teardown。

## 路由

Processors 可以把 event 固定到命名 transports：

```ts
import { routeProcessor } from "@loggerjs/processors";

routeProcessor([{ minLevel: "error", transports: ["alerts"] }]);
```

Routes 作为不可枚举 event metadata 附加，并在 dispatch 时使用。Record fast path 不执行 route 过滤：routes 只能由 processors 附加，而 record path 只会在 logger 没有 processor 时运行。

## Levels、Categories、Sources

- Levels 是数字（`trace` 10 到 `fatal` 60）并带名称；自定义数字级别在各处可用。
- Categories 是字符串数组（`["api", "checkout"]`），在 events 中 join 成点分 logger 名；registry 按 category prefix 路由配置。
- `source` 区分应用日志和 integration 捕获日志，因此 console capture 可以从 console output 中排除，也能检测循环。

## 内部错误和 Meta Counters

管线永远不会把错误抛进应用代码。Middleware、processors、codecs 和 transports 中的失败会通过 `onInternalError` 上报，并计入 logger meta：

```ts
import { getLoggerMetaStats } from "@loggerjs/core";

getLoggerMetaStats();
// { "transport.errors": 1, "transport.dropped.queue-full": 2, "codec.fallback": 1, ... }
```

用这些 counters 监控静默退化：队列丢弃、codec fallback、integration 重入丢弃等。`getLoggerSelfMetrics()` 同时返回 counters 和 gauges，包括共享 transport helpers 暴露的 queue depth 和 circuit-breaker 状态。

## Trace 和语义事件

`trace-propagation` helpers 负责解析/格式化 W3C `traceparent` 和 baggage headers；`addContextProvider()` 允许 integrations 附加 ambient context，而不替换应用自己的 context provider。`semanticEvents` 定义常见事件家族（`error`、`http`、`db`、`job`、`ui`、`action`、`security`、`performance`），让 integrations 和应用日志共享字段命名。

## 延伸阅读

- [架构](ARCHITECTURE.md)：完整设计文档、invariants 和决策记录。
- [传输](TRANSPORTS.md)、[集成](INTEGRATIONS.md)、[处理器](PROCESSORS.md)、[编解码](CODECS.md)：参考目录。
