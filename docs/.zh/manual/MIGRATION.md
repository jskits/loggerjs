# 迁移说明

本页说明如何从 pino、winston 和 `console.log` 迁移，并介绍从这些 logger 转过来时最容易让人意外的 LoggerJS 约定。

## 从 pino 迁移

相同 levels、相同 numeric values、相同 NDJSON 直觉，映射大多是机械的。

```ts
// pino
import pino from "pino";
const logger = pino({ level: "info", base: { service: "checkout" } });
logger.info({ orderId: "ord_123" }, "order created");
const child = logger.child({ requestId: "req_1" });

// loggerjs
import { createLogger, stdoutTransport } from "@loggerjs/node";
const logger = createLogger({
  level: "info",
  tags: { service: "checkout" },
  transports: [stdoutTransport()],
});
logger.info("order created", { orderId: "ord_123" }); // message first, data second
const child = logger.child({ bindings: { requestId: "req_1" } });
```

关键差异：

- **参数顺序翻转**：pino 是 `(mergeObject, message)`，LoggerJS 是 `(message, data)`。Errors 在两者中都放前面：`logger.error(err, "msg")`。
- pino `base` fields 拆为 `tags`（稳定、低基数）和 `bindings`（合并到 `context` 的上下文字段）。
- pino `serializers` 变成 processors（`normalizeErrorProcessor`、`redactProcessor`、自定义 `enrichProcessor`），在序列化前作用于结构化数据。
- pino redaction 映射到 `redactProcessor({ paths, censor, remove })`；`replacement` 是 LoggerJS 原生命名，等价于 `censor`；热日志器优先使用精确 key/path matching。
- pino `transport`/`destination` 变成 LoggerJS transport：`stdoutTransport()`、`fileTransport()`、`nodeHttpTransport()`。
- pino-pretty 的角色由 `prettyStdoutTransport()` / `prettyStderrTransport()`（terminal）或 `prettyConsoleTransport()`（browser DevTools）承担。Core `consoleTransport()` 仍是基础本地 console sink。
- 需要 Pino-shaped NDJSON 时，使用 `@loggerjs/codecs` 的 `pinoCompatCodec()`。Root data merging 是 opt-in（`mergeData: true`），保留键冲突默认嵌套，而不是覆盖 `time`、`level`、`msg`、`pid`、`hostname` 或 `err`。
- 最快 LoggerJS lean envelope 使用 `fastEventJsonCodec({ includeId: false, includeSeq: false, includeLevelName: false })`。Record-aware custom transports 可以用 `createPreparedRecordEncoder(codec)` 包装它，复用稳定 logger/tag fragments。在 M1 Max 参考机器上，plain lean path 约 1.19x pino，prepared lean path 约 1.28x（paired A/B；相对 pino 排序依赖 CPU/V8，见 [基准](BENCHMARKS.md)）；在这个吞吐基础上，你还得到 middleware、integrations、multi-transport fan-out 和同构浏览器故事。

## 从 winston 迁移

```ts
// winston
import winston from "winston";
const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  defaultMeta: { service: "checkout" },
  transports: [new winston.transports.Console(), new winston.transports.File({ filename: "app.log" })],
});

// loggerjs
import { createLogger, fileTransport, stdoutTransport } from "@loggerjs/node";
const logger = createLogger({
  level: "info",
  tags: { service: "checkout" },
  transports: [stdoutTransport(), fileTransport({ path: "app.log" })],
});
```

关键差异：

- winston `format` chains 拆成两个关注点：**processors/middleware**（数据塑形：redact、enrich、filter）和 **codecs**（序列化，由每个 transport 拥有）。`format.combine(timestamp, json)` 通常就是默认输出。
- `defaultMeta` -> `tags` 和/或 `bindings`。
- Per-transport `level` 直接映射到任何 transport 的 `minLevel`。
- Child loggers 替代 `winston.loggers` registries 做 per-module configuration；库作者优先使用 core 的 `getLogger()`。
- 在顺序基准套件中，LoggerJS lean 路径的吞吐量约为 winston 的 10 倍（见 [基准](BENCHMARKS.md)）。

## 从 console.log 迁移

两种迁移方式可以组合使用。

**先捕获，逐步迁移**：不改调用点，把已有 console calls 转成结构化日志：

```ts
import { captureConsoleIntegration, createLogger, browserHttpTransport } from "@loggerjs/browser";

const logger = createLogger({
  transports: [browserHttpTransport({ url: "/api/logs" })],
  integrations: [captureConsoleIntegration({ levels: ["log", "warn", "error"] })],
});
```

**再在值得结构化的调用点替换**：

```ts
// before
console.log("order created", orderId);
console.error("payment failed", err);

// after
logger.info("order created", { orderId });
logger.error(err, "payment failed");
```

每一步获得的收益：levels 和 level gating、结构化数据替代插值字符串、数据离开进程前 redaction、batching/offline delivery，以及通过 error/process integrations 捕获 crash path。

---

## Middleware 与 Processor

LoggerJS 有两层同步的数据处理，二者都是一等公民：

- **Middleware** 在计算 id、消息或错误之前运行在原始 `LogRecord` 上。它是补充字段、脱敏或丢弃日志成本最低的位置，并且不会破坏 record 快速路径。
- **Processor** 运行在投影后的 `LogEvent` 上。需要解析后的 event 结构时使用它，例如路由、指纹或 fingers-crossed 缓冲。只要配置了任意 processor，该 logger 就不再走 record 快速路径。

`@loggerjs/processors` 同时提供两种形式，例如 `tagsMiddleware()` 和 `tagsProcessor()`。自定义 middleware 使用 `createMiddleware()`：

```ts
import { createMiddleware } from "@loggerjs/core/middleware";
import { redactProcessor, tagsMiddleware } from "@loggerjs/processors";

const logger = createLogger({
  middleware: [tagsMiddleware({ service: "checkout" })],
  processors: [redactProcessor()],
});
```

完整模型见 [核心概念](CONCEPTS.md)。

## Context

创建 logger 时就已知的 context 用 child logger 绑定：

```ts
const requestLogger = logger.child({ bindings: { requestId: "req_123" } });
```

请求作用域使用环境 context：

```ts
import { withContext } from "@loggerjs/core";
import { installAsyncLocalStorageContext } from "@loggerjs/node";

installAsyncLocalStorageContext();
await withContext({ requestId: "req_123" }, async () => {
  logger.info("request started");
});
```

## 浏览器 Integration

浏览器采集需要主动开启。在配置对应的 integration 之前，现有的手动日志代码不会捕获 console 调用、错误、fetch 或 XHR。

常见的起步组合：

```ts
captureConsoleIntegration({ levels: ["warn", "error"] });
captureBrowserErrorsIntegration();
captureFetchIntegration();
pageLifecycleIntegration();
```

## Transport 与 Codec

序列化属于 transport。把 JSON 或字符串格式化从 middleware 和 processor 中移出，交给 transport 的 codec：

```ts
browserHttpTransport({ url: "/api/logs", codec: safeJsonCodec() });
```

编写自定义 transport 时，实现 `write`/`writeBatch` 可以在快速路径上接收 `LogRecord`，实现 `log`/`logBatch` 则接收投影后的 `LogEvent`。凡是涉及网络 I/O 的 transport，都应使用 `batchTransport()` 包装，以获得队列上限、重试、字节限制、并发和熔断能力。见 [传输](TRANSPORTS.md#编写自定义-transport)。

## 包导入

根入口在任何环境都可用：

```ts
import { createLogger } from "@loggerjs/core";
```

子路径提供更窄的导入：

```ts
import { createMiddleware } from "@loggerjs/core/middleware";
import { browserHttpTransport } from "@loggerjs/browser/transport-http";
import { stdoutTransport } from "@loggerjs/node/transport-stdout";
```

每个包都发布 ESM 和 CJS 入口，类型声明按 NodeNext 包解析方式检查。
