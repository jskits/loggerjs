# 运维

本指南覆盖最影响 LoggerJS 生产行为的部分：隐私、浏览器缓冲、崩溃路径和远程投递可靠性。

## 隐私

所有自动采集的 integration 都需要主动开启。只开启产品实际需要的采集范围。

推荐默认值：

- 在任何 remote transport 之前使用 `redactProcessor()`。
- 在 fetch/XHR integration 中为 HTTP header 设置允许列表。默认不要发送 cookie、authorization header 或完整的请求 body。
- 当 query string 可能包含 token 或用户数据时，清洗 URLs。
- 除非明确需要 debug collection，否则 console capture 只采集 `warn` 和 `error`。
- 使用稳定 tags，例如 `service`、`env`、`runtime`；把高基数字段放进 event data，而不是 tags。

示例：

```ts
import { captureFetchIntegration } from "@loggerjs/browser";
import { redactProcessor } from "@loggerjs/processors";

const processors = [redactProcessor({ keys: ["password", "token", /secret/i] })];
const integrations = [
  captureFetchIntegration({
    captureRequestHeaders: ["content-type", "x-request-id"],
    captureResponseHeaders: ["content-type", "x-request-id"],
    sanitizeUrl: (url) => new URL(url, location.origin).origin,
  }),
];
```

`redactProcessor()` 可按 key、精确 dot path、regex 或自定义 matcher mask。Paths 相对于每个被脱敏的 event field（`user.password`，不是 `data.user.password`）。用 `replacement`（或兼容 Pino 的 `censor` 别名）mask 值；字段应从 event 中省略时使用 `remove: true`。LoggerJS 不用 `eval` 或 `new Function` 编译 redaction paths；类似 wildcard 的 regex 和深度遍历比生成代码更安全，但成本高于精确 keys 和 paths。

`privacyGuardProcessor()` 更宽泛：它扫描选定字段中的内置和自定义字符串 patterns，例如 emails、bearer tokens 和类似银行卡号的值。把它当成安全网，而不是 capture allowlists 的替代品。

## 浏览器队列和离线重放

`browserHttpTransport()` 会在内存中批量 records，并能把失败 payload 持久化到 offline queue adapter。`memoryBrowserHttpOfflineQueue()` 只在页面存活期间保留 payload；需要在刷新后仍保留队列时，使用内置的 `indexedDbBrowserHttpOfflineQueue()`，或传入实现相同接口的自定义适配器。

```ts
import { browserHttpTransport, memoryBrowserHttpOfflineQueue } from "@loggerjs/browser";

const transport = browserHttpTransport({
  url: "/api/logs",
  maxBatchSize: 50,
  maxQueueSize: 1000,
  offlineQueue: memoryBrowserHttpOfflineQueue({ maxEntries: 500 }),
  useBeaconOnPageHide: true,
  beaconMaxBytes: 60 * 1024,
});
```

transport 会在以下时机带重试和退避地重放已存储的 payload：浏览器触发 `online` 时；transport 创建后不久（这样上一次页面加载持久化的 payload 也会被发送，可用 `offlineReplayOnStart: false` 关闭）；某次 flush 中有实时批次成功送达收集端之后；以及在没有待发送实时日志时显式调用 `flush()`。重放失败时条目会留在队列中，并通过 `onInternalError` 上报，而不会让 flush 失败。如果关闭标签页或页面跳转时的日志很重要，请启用页面生命周期 integration：

```ts
import { pageLifecycleIntegration } from "@loggerjs/browser";

const integrations = [pageLifecycleIntegration()];
```

`maxBatchSize` 默认是 50，必须是正安全整数。它既是自动 flush 的触发阈值，也限制每个新 Fetch 或 Beacon 请求中的 event 数。Fetch 串行排空，包括最后不足一批的日志；`flushIntervalMs: 0` 也不会阻止后续批次发送。并发 `flush()` 等待同一轮排空，新产生的日志也会被处理，直到队列为空。失败批次恢复到队首并终止本轮，除非离线队列已接受编码后的 payload；之前成功的批次不会重新入队。

这个限制计算条数，不是字节数。Beacon 还受 `beaconMaxBytes` 限制；Fetch 没有严格 payload 字节预算。拆分批次可能增加请求数和 codec/transform 调用次数。离线容量 `maxEntries` 计算已编码请求数，而非 event 数。已保存的 payload 原样 replay，包括超过当前条数限制的旧批次。离线 replay 和实时投递不保证全局顺序或 exactly-once。

Pagehide、隐藏页面和 `close()` 会同步提交仍在队列中的 Beacon 分块，即使之前的 Fetch 尚未完成；发送中的 Fetch 批次不会再经 Beacon 重复发送，`close()` 仍等待它完成。这条尽力而为的退出路径可能让服务端乱序收到请求。未被接受的 Beacon 分块回退到按条数限制的 Fetch。设置 `transformPayload` 时，生命周期 flush 仍使用 Fetch。flush 成功可能只表示离线队列或浏览器 Beacon 队列接受了日志，不代表服务器确认收货。

浏览器的存储和关闭行为依然只能尽力而为。`sendBeacon` 可能受大小限制，或在页面关闭时被跳过；内存队列在刷新后会消失；IndexedDB 可能不可用、已满、被驱逐，或被版本升级阻塞。生产环境的浏览器投递建议组合使用：

- `browserHttpTransport()`：常规远程投递。
- `indexedDbBrowserHttpOfflineQueue()` 或 `offlineFirstTransport()`：reload-surviving replay。
- `pageLifecycleIntegration()` 和 `useBeaconOnPageHide`：最后机会 flush。
- logger meta 中的丢弃/队列指标：让配额或背压问题可见。

## Node 崩溃路径

进程级失败建议组合 `captureProcessIntegration()` 和至少一个能在需要时同步 flush 的 transport。

```ts
import { captureProcessIntegration, fileTransport, stdoutTransport } from "@loggerjs/node";

const transports = [
  stdoutTransport(),
  fileTransport({ path: "./logs/app.ndjson" }),
];
const integrations = [captureProcessIntegration({ exitOnUncaught: true })];
```

崩溃路径建议：

- 至少为致命的进程事件保留一个本地 transport。
- transport 支持时，最终同步 shutdown 优先用 `flushSync()`；普通 drain-and-continue shutdown 使用 `await flush()`。
- 每次写入都必须在日志调用返回前到达文件系统时，使用 `fileTransport({ sync: true })`。
- HTTP/OTLP 远程 transport 用于常规投递，不要作为致命错误路径上唯一的 sink。
- processor 工作保持同步且有界；crash handlers 不应执行慢 enrichment。

对带 `exitOnUncaught: true` 的 `uncaughtException`，流程是：

1. 捕获一条带 `process.kind: "uncaughtException"` 的 `fatal` record。
2. 对支持同步的 transports 调用 `flushSync()`。
3. 运行一次由 `flushTimeoutMs` 控制的有界 async `flush()` race（默认 `250` ms）。
4. 以 code `1` 退出。

未处理的 promise rejection 默认也走同样的流程并以退出码 `1` 退出，与 Node 默认的 `--unhandled-rejections=throw` 行为一致（注册监听器本来会让这个默认行为失效）。当 Node 以 `--unhandled-rejections=warn`、`none` 或 `warn-with-error-code` 运行时，只记录日志不退出；可以用 `exitOnUnhandledRejection` 显式覆盖。

对于启用了 `exitOnSignal: true` 的信号，LoggerJS 会记录一条致命的信号日志，执行同样的“同步 flush + 有时限的异步 flush”流程，然后按已知的信号退出码退出（`SIGTERM` -> `143`，`SIGINT` -> `130`）。

## 远程 Transport 可靠性

基于批量的 transport 都支持同一套 core 可靠性选项：

```ts
{
  maxRecords: 100,
  maxBytes: 64 * 1024,
  maxWaitMs: 2000,
  concurrency: 2,
  maxRetries: 3,
  retryBaseDelayMs: 250,
  retryMaxDelayMs: 5000,
  circuitBreakerFailureThreshold: 5,
  circuitBreakerResetMs: 30000,
}
```

当 payload 大小比条数更重要时，使用字节限制。用 `onDrop` 把队列丢弃情况接入你自己的指标系统。

## Context 和 Trace 关联

创建时就已知的值用显式的 child context；请求级别的值用环境 context：

```ts
import { installAsyncLocalStorageContext } from "@loggerjs/node";
import { withContext } from "@loggerjs/core";

installAsyncLocalStorageContext();

await withContext({ requestId: "req_123" }, async () => {
  logger.info("request started");
});
```

当 OpenTelemetry API 对象可用时，用 `openTelemetryTraceProcessor()` 附加当前活跃 span 的 context。
