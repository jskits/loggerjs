# 快速开始

LoggerJS 是一个同构的结构化日志 SDK。同一套 core API 可以运行在 Node、浏览器、worker 和 edge runtime 中；平台包在 core 之上增加 transport 和自动采集能力。

## 安装

按运行平台选择包。每个平台包都会重新导出 `@loggerjs/core` 的全部内容，所以安装一个平台包就足以开始使用。

```bash
# Node services
pnpm add @loggerjs/node @loggerjs/processors

# Browser apps
pnpm add @loggerjs/browser @loggerjs/processors
```

所有包都提供 ESM 和 CJS 入口，并带完整 TypeScript 声明。对 Node 消费者，发布 tarball 会在 Node 20.19.0、22 和 24 上做 smoke test。仓库开发使用 Node >=22.13.0 来运行完整工具链。

## 第一个 Logger（Node）

```ts
import { captureProcessIntegration, createLogger, stdoutTransport } from "@loggerjs/node";
import { redactProcessor } from "@loggerjs/processors";

const logger = createLogger({
  category: ["api"],
  level: "info",
  tags: { service: "checkout", env: process.env.NODE_ENV ?? "dev" },
  processors: [redactProcessor()],
  transports: [stdoutTransport()],
  integrations: [captureProcessIntegration()],
});

logger.info("order created", { orderId: "ord_123" });
logger.error("payment failed", new Error("card declined"));

await logger.flush();
```

`stdoutTransport()` 每条日志写出一行 NDJSON。`captureProcessIntegration()` 会自动把 uncaught exception、unhandled rejection 和 process warning 转成日志事件。

## 第一个 Logger（Browser）

```ts
import {
  browserHttpTransport,
  captureBrowserErrorsIntegration,
  captureConsoleIntegration,
  createLogger,
  memoryBrowserHttpOfflineQueue,
  pageLifecycleIntegration,
} from "@loggerjs/browser";

const logger = createLogger({
  category: ["web"],
  level: "info",
  transports: [
    browserHttpTransport({
      url: "/api/logs",
      offlineQueue: memoryBrowserHttpOfflineQueue({ maxEntries: 500 }),
      useBeaconOnPageHide: true,
    }),
  ],
  integrations: [
    captureConsoleIntegration({ levels: ["warn", "error"] }),
    captureBrowserErrorsIntegration(),
    pageLifecycleIntegration(),
  ],
});

logger.info("page loaded");
```

HTTP transport 会批量发送日志；离线时写入队列；浏览器恢复 `online` 后重放；页面关闭时回退到 `navigator.sendBeacon` 做最后机会投递。

## 级别

六个启用级别，加上 `silent`：

| 名称 | 数值 |
| --- | ---: |
| `trace` | 10 |
| `debug` | 20 |
| `info` | 30 |
| `warn` | 40 |
| `error` | 50 |
| `fatal` | 60 |

```ts
logger.setLevel("debug");
logger.isLevelEnabled("trace"); // false
```

禁用级别只付出一次数字比较成本：不分配对象、不查上下文、不格式化消息。

## 惰性消息

当构造消息很贵时，传入函数。只有级别启用时才会调用，并且最多调用一次：

```ts
logger.debug(() => `cart state: ${JSON.stringify(cart)}`);
```

## 错误

第一个参数是 `Error` 时，它会成为 record 的 error；也可以显式给一条消息：

```ts
logger.error(err);
logger.error(err, "payment failed", { orderId: "ord_123" });
```

transport 看到错误之前，LoggerJS 会先把错误标准化为 name、message、截断 stack、可枚举属性和 cause 链。

## 子 Logger 和 Tags

```ts
const checkoutLogger = logger.child({
  category: ["api", "checkout"],
  tags: { domain: "checkout" },
});
```

子 logger 继承 level、tags、bindings、middleware、processors 和 transports；integrations 不会继承。`withTags()` 和 `withType()` 是常见子 logger 形态的快捷方式。

## 环境上下文

把 request 级别的值绑定一次，不需要每次日志调用都手动传：

```ts
import { withContext } from "@loggerjs/core";
import { installAsyncLocalStorageContext } from "@loggerjs/node";

installAsyncLocalStorageContext(); // 启动时调用一次

await withContext({ requestId: "req_123" }, async () => {
  logger.info("request started"); // context: { requestId: "req_123" }
});
```

浏览器默认的栈式 context manager 覆盖同步作用域；Node 中的 AsyncLocalStorage 会让 context 跨 `await` 边界传播。

## 类型化事件

定义可复用、带类型的事件形状：

```ts
import { defineEvent } from "@loggerjs/core";

const CheckoutCompleted = defineEvent<{ orderId: string; amountCents: number }>({
  type: "checkout.completed",
  message: (event) => `checkout completed ${event.orderId}`,
  tags: { domain: "checkout" },
});

logger.event(CheckoutCompleted, { orderId: "ord_123", amountCents: 4999 });
```

## 库作者：Registry

库代码不应该自己构造 logger；它按 category 查找 logger，并在宿主应用配置输出之前保持静默：

```ts
// In the library
import { getLogger } from "@loggerjs/core";
const logger = getLogger(["my-lib", "client"]);
logger.debug("handshake started"); // 配置前是 no-op

// In the application
import { configure } from "@loggerjs/core";
await configure({
  transports: { stdout: stdoutTransport() },
  loggers: [{ category: ["my-lib"], level: "warn", transports: ["stdout"] }],
});
```

## 关闭

```ts
await logger.flush(); // drain pending transport work
await logger.close(); // tear down integrations, close transports
```

崩溃路径中，支持同步刷新的 transport 会暴露 `flushSync()`；详见 [运维](OPERATIONS.md)。

## 下一步

- [核心概念](CONCEPTS.md)：records、events、middleware、processors、transports、codecs 的管线模型。
- [传输](TRANSPORTS.md)：所有内置 transport，以及如何编写自定义 transport。
- [友好输出](PRETTY.md)：浏览器 DevTools 和 Node 终端的人类可读输出。
- [集成](INTEGRATIONS.md)：浏览器和 Node 自动采集。
- [处理器](PROCESSORS.md)：middleware/processor 工具箱。
- [编解码](CODECS.md)：序列化归属和 codec 合约。
- [性能](PERFORMANCE.md)：如何按吞吐量配置。
- [运维](OPERATIONS.md)：隐私、离线队列和崩溃路径。
- [生产配方](PRODUCTION-RECIPES.md)：浏览器 HTTP/offline、Node stdout+OTLP、Loki/Datadog 部署。
- [API 稳定性](API-STABILITY.md)：v1 稳定 API 子集和 pre-1.0 兼容策略。
- [迁移](MIGRATION.md)：从 pino、winston 或 console 迁移。
