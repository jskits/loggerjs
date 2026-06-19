# 传输

Transport 负责把日志 records 或 events 投递到某个目的地。本页列出所有内置 transport，并说明如何编写自己的 transport。精确 option types 以各 package 的 TypeScript declarations 和 `api-reports/` 为准。

每个 transport 到源码文件、公开入口和契约测试的可审计映射，见 [传输契约矩阵](TRANSPORT-CONTRACTS.md)。

## Runtime 支持

| Runtime | Transport support | 说明 |
| --- | --- | --- |
| Core / runtime-neutral | `consoleTransport`, `memoryTransport`, `testTransport`, `batchTransport`, `retryTransport`, `fallbackTransport` | 不依赖浏览器或 Node.js 专属 API。Wrappers 可以包住当前 runtime 可用的任何 transport。 |
| Pretty / developer UX | `prettyConsoleTransport`, `prettyStreamTransport`, `prettyStdoutTransport`, `prettyStderrTransport` | 来自 `@loggerjs/pretty` 的浏览器 DevTools 和 Node terminal 显示 transports。用于人类可读输出，不是 durable production delivery。 |
| Browser / frontend | `browserHttpTransport`, IndexedDB queues/store, WebSocket, service worker, BroadcastChannel, offline-first replay | 使用 `fetch`、`sendBeacon`、`IndexedDB`、`navigator.onLine`、service workers 和 BroadcastChannel 等浏览器 API；在可用处做 feature detection 和 fallback。 |
| Node.js / server | `stdoutTransport`, `stderrTransport`, `fileTransport`, `rotatingFileTransport`, `nodeHttpTransport`, `nodeSyslogTransport`, `workerTransport` | 使用 Node.js streams、filesystem、worker threads、network sockets 和 Node fetch。 |
| Vendor / observability | OTLP, Sentry, Datadog, Elastic, Loki, CloudWatch | HTTP wire transports 在具备 `fetch`/crypto/runtime 要求的环境中运行；SDK/provider adapters 需要应用传入已初始化的 SDK object 或 provider。Vendor credentials 通常更适合放在服务器或可信 worker。 |
| Database / local app / backend | `databaseTransport`, `postgresTransport`, `sqliteTransport` | LoggerJS 层是 driver-agnostic，但应用必须提供数据库 drivers；面向 Node.js、Electron、CLIs 或 backend workers。 |

## 稳定性级别

Transport 稳定性描述 public API 承诺，不是绝对投递保证。浏览器存储、进程关闭、网络 collectors 和 vendor backends 仍可能失败；下方可靠性表才是投递契约。

| 级别 | 含义 |
| --- | --- |
| Stable | 计划用于 v1-compatible application use。Option names 和高层语义由 API reports、tests 和 docs 保护。 |
| Compatible | 公开且有测试，但精确 runtime behavior 或 message shape 在 v1 前仍可能调整。适用于 caveats 与部署匹配的场景。 |
| Experimental | 公开且有测试，但还不属于 v1 兼容承诺。Names、options、payload mapping 或 batching guidance 在 v1 前可能变化。 |
| Runtime-dependent | Public API 稳定，但实际可靠性高度依赖 LoggerJS 外部的浏览器、worker、storage、network、SDK 或 database 行为。必须在目标环境验证。 |
| Test-only | 为 assertions 和 fixtures 构建，不用于生产投递。 |

| Transport | Stability | 原因 |
| --- | --- | --- |
| `consoleTransport()` | Stable | Runtime-neutral local sink，并为 console capture 做 loop prevention。 |
| `memoryTransport()` | Stable | 有界 in-memory diagnostics cache；有意非 durable。 |
| `testTransport()` | Test-only | 带 wait/snapshot APIs 的 assertion helper。 |
| `batchTransport()` / `retryTransport()` / `fallbackTransport()` | Stable | 第一方 transports 使用的 core reliability wrappers。 |
| Pretty transports | Stable | Developer display API 稳定；具体颜色/布局属于表现细节。 |
| `stdoutTransport()` / `stderrTransport()` / `fileTransport()` | Stable | 带 drain 和 crash-path 行为的生产本地 sinks。 |
| `rotatingFileTransport()` | Stable | 本地 size rotation；每个文件使用一个 writer process。 |
| `nodeHttpTransport()` | Stable | 自带 batch 包装的 HTTP delivery，共享 reliability options。 |
| `otlpHttpTransport()` | Experimental | OTLP mapping 公开且有测试，但 observability adapter packages 在 v1 前不冻结。 |
| `nodeSyslogTransport()` | Stable | Wire formatting 稳定；UDP/TCP 可靠性遵循 syslog transport 语义。 |
| `workerTransport()` | Compatible | Message protocol 公开，但 ready/ack/fallback lifecycle tuning 可能继续演进。 |
| `browserHttpTransport()` | Stable | 主要 browser remote transport；pagehide beacon 仍是 best effort。 |
| `memoryBrowserHttpOfflineQueue()` | Stable | 临时离线期 API 稳定；不具备 reload durability。 |
| `indexedDbBrowserHttpOfflineQueue()` / `indexedDbTransport()` / `offlineFirstTransport()` | Runtime-dependent | API 稳定，但持久性依赖浏览器 IndexedDB、quota、eviction、private mode 和 storage policy。 |
| `browserWebSocketTransport()` | Compatible | 适合 live/debug channels；reconnection 和最终 durability 由调用方负责。 |
| `browserServiceWorkerTransport()` | Runtime-dependent | API 公开，但 delivery 依赖 service worker registration、activation 和 lifetime。 |
| `browserBroadcastChannelTransport()` | Compatible | 同源 tab fan-out 有意是 lossy 且 receiver-dependent。 |
| Datadog / Elastic / Loki / CloudWatch transports | Experimental | Wire payloads 有测试，但 vendor packages 在 v1 前不冻结；生产 durability 需要在 raw transports 外包 batching/retry。 |
| `sentryTransport()` / `openTelemetryLogBridgeTransport()` | Experimental | Adapter contracts 公开且有测试，但 SDK/provider mapping 在 v1 前仍可能变化。 |
| `databaseTransport()` / `sqliteTransport()` / `postgresTransport()` | Experimental | Adapter APIs 公开且有测试，但 driver transaction 和 schema expectations 还需要更多 design-partner 验证。 |

## Import Boundaries

Root package imports 是方便入口。Public transport subpaths 被明确记录，用户可以选择更窄的 bundle，新内置 transports 也不能在没有对应文档时悄悄扩大 surface。

| Runtime | Public transport subpaths |
| --- | --- |
| Core | `@loggerjs/core/transport-console`, `@loggerjs/core/transport-batch`, `@loggerjs/core/transport-reliability`, `@loggerjs/core/transport-test` |
| Browser | `@loggerjs/browser/transport-http`, `@loggerjs/browser/transport-broadcast-channel`, `@loggerjs/browser/transport-service-worker`, `@loggerjs/browser/transport-websocket`, `@loggerjs/browser/transport-indexeddb`, `@loggerjs/browser/offline-first-transport` |
| Node.js | `@loggerjs/node/transport-http`, `@loggerjs/node/transport-file`, `@loggerjs/node/transport-rotating-file`, `@loggerjs/node/transport-stdout`, `@loggerjs/node/transport-syslog`, `@loggerjs/node/transport-worker` |
| Pretty | `@loggerjs/pretty/transport-console`, `@loggerjs/pretty/transport-stream` |
| Observability and data | `@loggerjs/otel/transport-http`, `@loggerjs/sentry/transport`, `@loggerjs/datadog/transport`, `@loggerjs/elastic/transport`, `@loggerjs/loki/transport`, `@loggerjs/cloudwatch/transport`, `@loggerjs/database/transport` |

当 public transport subpath 被导出但未列在这里时，`pnpm verify:component-docs` 会失败。新增 entries 也应该更新上方稳定性和可靠性表。

## 可靠性姿态

Transports 默认可组合。有些 transports 内部包含 batching 或 durable local storage；raw vendor wire transports 除非被包装，否则不会 retry。把下表视为生产投递契约：

| Transport 或 wrapper | 默认姿态 | 生产说明 |
| --- | --- | --- |
| `consoleTransport()` | 立即本地写入 | 人类/开发输出；除 console target 自身外没有 retry 或 durability。 |
| `prettyConsoleTransport()` / `prettyStdoutTransport()` / `prettyStderrTransport()` | 立即写出人类可读本地输出 | 只用于开发体验。生产投递使用结构化 transports。 |
| `memoryTransport()` | in-memory ring buffer | 仅 diagnostics cache；进程/页面退出即丢失。 |
| `testTransport()` | in-memory assertion sink | 仅测试；不是生产投递机制。 |
| `batchTransport(inner)` | 带可选 retry/circuit breaker 的 batch queue | raw I/O transports 需要 queue bounds、retries、backoff 或 drop accounting 时使用。 |
| `retryTransport(inner)` | 立即投递加 retry | inner transport 已拥有 batching，或 per-call retry 可接受时使用。 |
| `fallbackTransport(primary, fallback)` | primary 失败后走 fallback | 用作本地 backup sinks，不替代 queueing。 |
| `stdoutTransport()` / `stderrTransport()` | 立即 stream write，`flush()` 感知 drain，可选 `minLength` buffering | 本地 process sink；默认把 `EPIPE` 当成干净 shutdown。 |
| `fileTransport()` | 共享 file destination，支持 async stream mode、可选 `sync: true`、`mkdir`、`append`、`minLength` 和 crash-path `flushSync()` | 本地 durability path；每个文件优先一个 writer process。 |
| `rotatingFileTransport()` | 带 size rotation 的同步共享 file destination | 带大小轮转的本地 durability path；写入时阻塞调用方。 |
| `nodeHttpTransport()` | 自带 batch 包装的 HTTP delivery | 使用 `batchTransport`；生产中调节 queue、retry 和 circuit options。 |
| `nodeSyslogTransport()` | 立即 UDP/TCP syslog write | UDP 可丢；TCP 仍依赖 socket state 和 close/flush 行为。 |
| `workerTransport()` | worker offload，可选 ready/ack lifecycle | 默认 fire-and-forget；需要观察 worker acceptance 时配置 `readyTimeoutMs`、`ackTimeoutMs`、fallback 和 `autoEnd`；配置 ready handshake 后，`ready()` 等待 worker startup。 |
| `browserHttpTransport()` | batched fetch，可选 offline queue 和 beacon pagehide mode | reload survival 需要 IndexedDB queue；beacon mode 是 best-effort 且有大小限制。 |
| `memoryBrowserHttpOfflineQueue()` | in-memory offline queue | 可跨网络短暂中断，不跨 reload 或 tab close。 |
| `indexedDbBrowserHttpOfflineQueue()` | IndexedDB offline queue | quota/storage 可用时跨 reload。 |
| `offlineFirstTransport(remote)` | remote delivery 加 persistent queue replay | offline 或 remote failure 时 queue，之后 replay。 |
| `indexedDbTransport()` | 本地 IndexedDB persistence | 本地 support/export store；durability 依赖浏览器 storage policy 和 quota。 |
| `browserWebSocketTransport()` | socket closed 时 queue | Reconnection 由调用方负责；有界队列满时会 drop。 |
| `browserServiceWorkerTransport()` | queue 到 active service worker 可用；`target: "ready"` 时 `ready()` 可等待 `serviceWorker.ready` | Delivery 依赖 registration、activation 和 worker lifetime。 |
| `browserBroadcastChannelTransport()` | lossy tab broadcast | Receivers 必须已经监听；不 durable。 |
| `otlpHttpTransport()` | 自带 batch 包装的 OTLP/HTTP delivery | 使用 `batchTransport`；生产中调节 retry 和 circuit options。 |
| Datadog / Elastic / Loki / CloudWatch transports | raw HTTP wire delivery | 用 `batchTransport()` / `retryTransport()` 包装以获得 queueing、retry 和 circuit breaking。 |
| `sentryTransport()` / `openTelemetryLogBridgeTransport()` | SDK/provider adapter | 可靠性取决于传入的 SDK/provider。 |
| `databaseTransport()` / `sqliteTransport()` / `postgresTransport()` | batched database writes | 实际 transaction 和 connection 行为由 adapter/driver 拥有。 |

## Core / Runtime-Neutral（`@loggerjs/core`）

| Transport | 功能 |
| --- | --- |
| `consoleTransport()` | 按 level 的 pretty console output，或 `pretty: false` 时单行 JSON。通过 unpatched console 写出，避免 console capture 循环。默认过滤从 console 捕获来的 events。 |
| `memoryTransport()` | 最近 events 的 ring buffer（`maxEvents`，默认 1000）。适合 diagnostics endpoints 和 tests。 |
| `testTransport()` | 面向 assertion 的 sink：snapshots、call stats、`waitForEvent()`/`waitForCount()`、可注入失败。 |
| `batchTransport(inner, options)` | 为任意 transport 加 batching、retry 和 reliability controls。 |
| `retryTransport(inner, options)` | 为任意 transport 加 retries、exponential backoff、可选 circuit breaker 和可选 fallback。 |
| `fallbackTransport(primary, fallback)` | primary 抛错时发送到 fallback transport。 |

### `batchTransport` 可靠性选项

生态中的每个 batch-based transport 都共享这组选项：

```ts
batchTransport(inner, {
  maxRecords: 100,          // 队列达到这个数量时 flush
  maxBytes: 64 * 1024,      // 每 batch 字节预算（仅设置时估算）
  maxWaitMs: 2000,          // flush timer
  maxQueueSize: 1000,       // backpressure bound
  dropPolicy: "drop-oldest" /* | "drop-newest" | "throw" */,
  concurrency: 2,           // 并行 in-flight batches
  maxRetries: 3,
  retryBaseDelayMs: 250,    // exponential backoff base
  retryMaxDelayMs: 5000,
  circuitBreakerFailureThreshold: 5,
  circuitBreakerResetMs: 30000,
  onDrop: (event, reason) => metrics.increment(`log_drop.${reason}`),
});
```

注意：

- Byte estimation 会遍历 payload；只有 `maxBytes` 有限时才执行。
- Drops 总会计入 logger meta（`transport.dropped.*`）；只有注册了 listener 时才进行 `onDrop` 的 event conversion。
- 失败 batch 会重新入队到队头；circuit breaker 避免持续打爆死亡 endpoint。

## Pretty / Developer UX（`@loggerjs/pretty`）

| Transport / helper | 功能 |
| --- | --- |
| `prettyConsoleTransport()` | 浏览器 DevTools 和本地 console 输出：level labels、可读 details、可选 `%c` 浏览器样式、原始对象参数、console-capture loop filtering。 |
| `prettyStreamTransport({ stream })` | 向任意 writable stream-like target 写入人类可读行。按配置或 auto-detect 使用 ANSI colors。 |
| `prettyStdoutTransport()` / `prettyStderrTransport()` | `process.stdout` / `process.stderr` 之上的 Node terminal helpers；尊重 `NO_COLOR` 和 `FORCE_COLOR`，支持 `minLevel`，`flush()` 可等待 `drain`。 |
| `formatPrettyEvent()` | 自定义显示 transports 的共享 formatter。返回 plain text、ANSI text、browser console args 和 raw details。 |

Pretty transports 是显示 sinks。它们不 batch、不 retry、不 persist，也不实现 collector protocols。示例和选项建议见 [友好输出](PRETTY.md)。

## Node.js / Server（`@loggerjs/node`）

| Transport | 功能 |
| --- | --- |
| `stdoutTransport()` / `stderrTransport()` | NDJSON lines，带 write backpressure tracking、clean `EPIPE` handling 和可选 `minLength` buffering；`flush()` 等待 pending writes。 |
| `fileTransport({ path })` | 默认 append NDJSON 到文件；支持 `mkdir`、`append: false`、async `minLength` buffering、`sync: true` 和 crash-path `flushSync()`。 |
| `rotatingFileTransport({ path, maxBytes, maxFiles })` | 基于大小的 rotation，通过同一个 file destination 生成 numbered archives。同步写入；每个文件使用一个 logger process。 |
| `nodeHttpTransport({ url })` | 基于 fetch 的 HTTP delivery，包在 `batchTransport` 中（Node 18+）。 |
| `nodeSyslogTransport()` | UDP/TCP 上的 RFC syslog formatting；`formatSyslogMessage()` 单独导出。 |
| `workerTransport({ workerScript })` | 用 codec 编码 batches 并 post 到 worker thread，可选 transfer buffers；支持 ready timeout、batch ack waiting、fallback 和 `autoEnd`。 |

`nodeHttpTransport()` 接收 `transformPayload`，可在 codec 后做 wire transform。gzip、brotli 或 deflate 使用 `nodeCompressionPayloadTransform()`：

```ts
import { nodeCompressionPayloadTransform, nodeHttpTransport } from "@loggerjs/node";

nodeHttpTransport({
  url: "https://collector.example/logs",
  transformPayload: nodeCompressionPayloadTransform({ format: "brotli" }),
});
```

`fileTransport().flushSync()` 是 crash-path primitive。在 async stream mode 下，它会通过同步 fd 写出当前 buffered 或 pending payloads，让 fatal records 在进程退出前到达磁盘；如果进程继续运行，原 async stream 可能仍会完成。普通 drain-and-continue shutdown 使用 `await flush()`；每次写入都必须同步时配置 `sync: true`。

`workerTransport()` 仍兼容只接收 object messages 的简单 workers。Lifecycle 是 opt-in：

- 当 worker 会发送 `{ type: "loggerjs:ready" }` 时，设置 `readyTimeoutMs`。超时会标记 worker 失败，并把 batch 发送到 fallback，或计为 `transport.dropped.worker-ready-timeout`。显式 `transport.ready()` / `logger.ready()` 也会等待这个 startup handshake。
- 当 worker 会用 `{ type: "loggerjs:batch:ack", id }` ack 每个 batch 时，设置 `ackTimeoutMs`。`flush()` 会等待这些 acks。
- 主线程 post `{ type: "loggerjs:batch", id?, codec, contentType, count, payload }`。
- Worker 可用 `{ type: "loggerjs:error", message, error }` 报告失败；pending batches 会 fallback 或计为 dropped。
- `autoEnd` 默认 `true`；如果 worker 被共享且不应由 transport `close()` terminate，设置 `autoEnd: false`。

Worker lifecycle 会更新标准 transport gauges：`transport.ready.<name>` 和 `transport.queue.depth.<name>`；pending ack failures 会计入 `transport.worker.pending-dropped` 和 `transport.dropped.<reason>`。

Node runtime diagnostics 可以从 `@loggerjs/node` 调用 `installLoggerDiagnosticsChannel()`。它会把订阅的 LoggerJS internals 发布到 Node `diagnostics_channel` channels：`loggerjs.dispatch`、`loggerjs.transport`、`loggerjs.flush`、`loggerjs.encode` 和 `loggerjs.worker`。

## Browser / Frontend（`@loggerjs/browser`）

| Transport | 功能 |
| --- | --- |
| `browserHttpTransport({ url })` | Batching HTTP delivery，带 offline queue、online replay with backoff，以及 page hide 上的 `sendBeacon`（按 `beaconMaxBytes` 切块）。 |
| `memoryBrowserHttpOfflineQueue()` | In-memory offline queue adapter（reload 后丢失）。 |
| `indexedDbBrowserHttpOfflineQueue()` | IndexedDB 中的 durable offline queue；跨 reload。 |
| `offlineFirstTransport(remote)` | 标准 remote + persistent queue wrapper；offline 或 remote delivery 失败时 queue，之后 replay。 |
| `indexedDbTransport()` | 把 logs 本地持久化到 IndexedDB，支持 session-aware indexes、TTL/count/byte pruning、durability hints、可选 Storage Bucket isolation、async `query()` API、`sessions()` 和 `stats()` observability。 |
| `browserWebSocketTransport({ socket })` | 通过 WebSocket 发送 codec-encoded batches；socket closed 时 queue（reconnection 由调用方负责）。 |
| `browserServiceWorkerTransport()` | 把 events post 给 service worker，在 active worker 可用前 queue；`target: "ready"` 时显式 `ready()` 等待 `serviceWorker.ready`。 |
| `browserBroadcastChannelTransport({ channel })` | 把 logs fan out 到其他 tabs（天然 lossy；receivers 必须正在监听）。 |
| `exportLogsToZip(source)` / `createLogZipBlob()` / `downloadBlob()` | 把 logs（例如来自 `indexedDbTransport().query()`）打包成带 manifest、可选 per-session files、可选 `recent.ndjson`/`recent.json` 和 CRC 的 ZIP，用于 support workflows。 |

`browserHttpTransport()` 同样接收 `transformPayload`。支持 `CompressionStream` 的浏览器使用 `browserCompressionPayloadTransform()`：

```ts
import { browserCompressionPayloadTransform, browserHttpTransport } from "@loggerjs/browser";

browserHttpTransport({
  url: "/api/logs",
  transformPayload: browserCompressionPayloadTransform({ format: "gzip" }),
});
```

现代 Chrome 上进行高吞吐本地浏览器采集时，优先使用独立 IndexedDB log store，并设置 relaxed durability：

```ts
indexedDbTransport({
  durability: "relaxed",
  localStorageSpill: {
    maxBytes: 512 * 1024,
    maxEntries: 200,
    namespace: "loggerjs-support",
  },
  storageBucketName: "loggerjs-logs",
  storageBucketDurability: "relaxed",
});
```

不支持 Storage Buckets 的浏览器会回退到普通 IndexedDB instance，同时保持相同 transport API。

`indexedDbTransport()` 默认分配 page-session id，把它作为 IndexedDB entry 顶层字段存储，并在事件缺少 `event.context.sessionId` 时把同一个值写入 context。传 `session: false` 可关闭这个物化 session 字段；传 `session: { id, getId, contextKey }` 可让持久化 session 对齐你自己的浏览器 context provider。

`localStorageSpill` 是 reload/close 前的最后机会保护，不是 IndexedDB 的替代品。正常日志仍然先进入内存 batch，并异步 flush 到 IndexedDB。`pagehide` 或 `visibilitychange: hidden` 时，transport 会同步把尚未确认落盘的尾部日志（`pendingFlushBatch` 加当前内存 buffer）写入一个很小的 `localStorage` temp entry。下一次 transport 实例会先把这个 temp entry drain 到 IndexedDB，写成功后才清除。它能降低普通 reload 和 tab close 时的丢失窗口，但不能防 process kill、browser crash、storage disabled、quota exhaustion 或 storage eviction。

### Browser failure boundaries

除非日志已经被你关心的 destination acknowledge，否则浏览器投递都是 best effort。关键丢失窗口：

| Path | Failure boundary / loss window | 生产建议 |
| --- | --- | --- |
| `browserHttpTransport()` | In-memory batches 在 reload、tab close、process kill，或 queue bound 在投递前 drop records 时丢失。Fetch 可能被 navigation abort。 | 需要 reload survival 时使用有界 queues、retry options 和 IndexedDB offline queue。 |
| `browserHttpTransport({ useBeaconOnPageHide: true })` | `sendBeacon` 是 fire-and-forget。浏览器会限制 payload size，并可能在 shutdown pressure 下 reject、truncate 或 skip delivery。 | 保守设置 `beaconMaxBytes`，把 pagehide flush 当最后机会，不要作为唯一 durability path。 |
| `memoryBrowserHttpOfflineQueue()` | 只要 page process 存活，可跨临时 offline periods。 | 轻量应用或测试可用；需要 support/debug logs 跨 reload 时改用 IndexedDB。 |
| `indexedDbBrowserHttpOfflineQueue()` | 跨 reload 存储 replay payloads，但 quota、private browsing mode、storage eviction、blocked upgrades 或 IndexedDB 不可用仍可能阻止持久化。 | 监控 queue/drop counters，保持 payloads 有界；搭配 HTTP replay 和 page lifecycle flush。 |
| `offlineFirstTransport(remote)` | remote delivery 失败时 queue，之后 replay。如果 local storage 失败或被驱逐，replay 不是保证。 | 优先使用 persistent queue adapter；可控 shutdown/navigation 时尽量调用 `flush()`。 |
| `indexedDbTransport()` | 本地持久性依赖 IndexedDB availability、quota、eviction policy、durability hints 和 Storage Buckets 支持。仍在内存 buffer 中、尚未完成 async IndexedDB write 的日志可能丢失。 | 可接受时用 `durability: "relaxed"` 提高吞吐；用 TTL/count/byte pruning 保持低于 quota。support logs 需要更可靠地跨普通 reload 时，启用有界 `localStorageSpill`。 |
| `browserWebSocketTransport()` | 页面退出、queue bound 超出或调用方从不 reconnect socket 时，queued events 可能丢失。 | 在 transport 外负责 reconnection，并用 queue bounds/drop counters 检测 backpressure。 |
| `browserServiceWorkerTransport()` | Delivery 依赖 service worker registration、activation、message delivery 和 worker lifetime。Terminating worker 会丢 in-flight work，除非它自己持久化 queue。 | 只把它当 centralization；除非 service worker 也写 durable storage，否则不要当 durability。 |
| `browserBroadcastChannelTransport()` | BroadcastChannel 只到达当前打开、同源、正在监听的 tabs。Messages 不 durable，receivers 启动期间会错过。 | 用于 multi-tab aggregation 和 debugging，不作为 primary remote delivery guarantee。 |

常见生产浏览器栈是 HTTP batching + IndexedDB offline queue + page lifecycle flush。需要跨 tab centralization 时再加 service worker 或 BroadcastChannel；日志必须跨 reload 时，delivery path 中仍要有 durable queue。

## Payload transforms

Payload transforms 在 codec encoding 后、wire transport 发送或存储 payload 前运行。它们可以返回替换 payload，或 `{ payload, headers, contentType }`；HTTP transports 会把这些 headers 持久化到 offline queues 并在 replay 时保留。

```ts
import {
  composePayloadTransforms,
  encryptionPayloadTransform,
} from "@loggerjs/core/payload-transforms";
import { browserCompressionPayloadTransform, browserHttpTransport } from "@loggerjs/browser";

browserHttpTransport({
  url: "/api/logs",
  transformPayload: composePayloadTransforms(
    browserCompressionPayloadTransform(),
    encryptionPayloadTransform({
      contentType: "application/octet-stream",
      headers: { "x-payload-encrypted": "1" },
      encrypt: async (payload) => encryptForCollector(payload),
    }),
  ),
});
```

`encryptionPayloadTransform()` 提供 hook；加密算法和 key management 仍由应用拥有。

## Vendor packages

Vendor HTTP transports 通过 `fetch` 直接实现 wire protocol。Sentry 和 OpenTelemetry bridge 这类 SDK/provider adapters 使用应用已初始化的 SDK object 或 provider。`otlpHttpTransport()` 会自包 `batchTransport`；Datadog、Elastic、Loki 和 CloudWatch 暴露 `logBatch`，需要 queueing、retry 或 circuit-breaker 时用 core reliability wrappers 包住。

生产 vendor 使用应把 reliability wrapper 写出来：

```ts
import { batchTransport } from "@loggerjs/core";
import { datadogLogsTransport } from "@loggerjs/datadog";

const transport = batchTransport(datadogLogsTransport({ apiKey: process.env.DD_API_KEY }), {
  maxRecords: 100,
  maxWaitMs: 2000,
  maxQueueSize: 5000,
  maxRetries: 3,
  circuitBreakerFailureThreshold: 5,
});
```

| Package | Transport | Destination |
| --- | --- | --- |
| `@loggerjs/otel` | `otlpHttpTransport({ url })` | OTLP/HTTP JSON logs endpoint；导出 `otlpJsonCodec()` 和 mapping helpers。 |
| `@loggerjs/otel` | `openTelemetryLogBridgeTransport()` | Bridge into an OpenTelemetry `LoggerProvider`。 |
| `@loggerjs/sentry` | `sentryTransport({ sentry })` | Sentry structured logs、breadcrumbs、exception/message capture。 |
| `@loggerjs/datadog` | `datadogLogsTransport({ apiKey })` | Datadog Logs intake API。 |
| `@loggerjs/elastic` | `elasticTransport({ url, index })` | Elasticsearch `_bulk` API，支持 per-record index/pipeline/id selection。 |
| `@loggerjs/loki` | `lokiTransport({ url })` | Grafana Loki push API，带 stream labels 和 structured metadata。 |
| `@loggerjs/cloudwatch` | `cloudWatchLogsTransport({ ... })` | CloudWatch Logs `PutLogEvents`，内置 SigV4 signing。 |
| `@loggerjs/database` | `sqliteTransport()` / `postgresTransport()` / `databaseTransport(adapter)` | 通过 driver-agnostic adapters 做 batched inserts。 |

## 编写自定义 Transport

实现四类 delivery methods 中的任意一种。最简单的 event transport：

```ts
import type { Transport } from "@loggerjs/core";

const myTransport: Transport = {
  name: "my-sink",
  minLevel: "info",
  log(event) {
    push(JSON.stringify(event));
  },
};
```

Record-aware transport 会进入 fast path（logger 没有 processors 时不投影 event）：

```ts
import { fastEventJsonCodec } from "@loggerjs/codecs";
import { createPreparedRecordEncoder } from "@loggerjs/core";

const codec = fastEventJsonCodec();
const encodeRecord = createPreparedRecordEncoder(codec);
const recordSink: Transport = {
  name: "record-sink",
  write(record, context) {
    push(encodeRecord(record));
    // 需要 event shape？context.toEvent(record) 转换一次并 memoize，
    // 其他 transports 会共享同一次 projection。
  },
};
```

规则：

- 抛错（同步或 rejected promise）是安全的：错误会报告到 logger meta，其他 transports 继续运行。不要静默吞掉自己的错误，让它们暴露出来。
- 当调用方可以显式等待启动时，实现 `ready()`。`logger.ready()` 是 opt-in；普通日志调用永远不等待 transport readiness。
- 如果你会 buffer，实现 `flush()`；能在崩溃路径同步 drain 时实现 `flushSync()`；持有资源时实现 `close()`。
- 如果实现 `close()`，释放资源前包含自己的 best-effort flush。Core 有 `close()` 时会调用它；只有 transport 没有 `close()` 时才 fallback 到 `flush()`。
- 任何做 I/O 的 transport 优先使用 `logBatch`/`writeBatch` 加 `batchTransport`；per-event network calls 扛不住生产流量。
- 直接编码 raw records 会跳过 logger 的 `idFactory`；records 会得到文档化的 `defaultRecordId`。自定义 ids 很重要时，通过 `context.toEvent()` 转换。见 [编解码](CODECS.md)。
