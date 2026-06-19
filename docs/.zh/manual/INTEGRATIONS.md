# 集成

Integrations 会从平台行为中自动采集日志。它们始终是 **opt-in**：除非你配置了对应 integration，否则不会捕获任何内容。每次捕获都会带上 `source: "integration:<name>"`，方便下游过滤和防循环。

启用哪些采集、如何清洗数据的隐私建议见 [运维](OPERATIONS.md)。

## Runtime 支持

| Runtime | 支持 | 数量 | 说明 |
| --- | --- | ---: | --- |
| Browser / frontend | `@loggerjs/browser` 中的一方 automatic collectors | 19 | Console、script errors、fetch/XHR、WebSocket、Web Vitals、Performance API、routing、user actions、service worker、extension/Electron renderer hooks 和 browser context propagation。 |
| Node.js / server | `@loggerjs/node` 中的一方 automatic collectors | 16 | Process crashes、diagnostics channels、HTTP frameworks、outgoing clients、CLI/serverless lifecycle、queues 和 database clients。 |
| Runtime-neutral / core | `@loggerjs/core` 只提供 Integration API | - | core package 定义 integration contract 和 loop-prevention helpers；平台采集位于 browser 和 Node.js packages。 |

自定义 integrations 应 feature-detect 平台表面，不可用时 no-op。

## 稳定性级别

Integration 稳定性描述 public setup/options contract 和 teardown behavior。它不表示底层平台在每个 runtime、浏览器版本、框架版本或部署模式中都会发出每个信号。

| 级别 | 含义 |
| --- | --- |
| Stable | 计划用于 v1-compatible application use。Option names、setup/teardown behavior 和高层 captured fields 受保护。 |
| Compatible | 公开且有测试，但 exact field shape 或 framework/runtime edge handling 在 v1 前仍可能细化。 |
| Runtime-dependent | Public API 稳定，但信号本身依赖 platform support、browser policy、framework hooks 或 deployment lifecycle behavior。 |

| Integration | Stability | 原因 |
| --- | --- | --- |
| `captureConsoleIntegration()` | Stable | 主要 browser capture primitive，带 loop prevention 和 teardown coverage。 |
| `captureBrowserErrorsIntegration()` | Stable | 标准 browser error 和 rejection capture；CSP 细节因浏览器而异。 |
| `captureFetchIntegration()` / `captureXHRIntegration()` | Stable | Request/response capture contract 稳定，并有显式 sanitization hooks。 |
| `pageLifecycleIntegration()` | Runtime-dependent | API 稳定，但 pagehide/visibility timing 由浏览器控制且 best effort。 |
| `captureWebVitalsIntegration()` | Runtime-dependent | 依赖 PerformanceObserver 和浏览器 metric support。 |
| `capturePerformanceIntegration()` | Runtime-dependent | Entry availability 因浏览器、permission policy 和 page lifecycle 不同。 |
| `captureReportingIntegration()` | Runtime-dependent | ReportingObserver 和 report types 在浏览器间不同。 |
| `captureRouterIntegration()` | Stable | generic browser routing 的 history/hash capture 稳定。 |
| Framework router adapters | Compatible | Public adapters 有测试，但 framework-specific hook shapes 可能演进。 |
| `captureFrameworkErrorsIntegration()` | Compatible | Public helper API 稳定；framework error hook payloads 仍由框架拥有。 |
| `captureUserActionsIntegration()` | Compatible | Privacy-first defaults 稳定；element metadata heuristics 可能调整。 |
| `captureWebSocketIntegration()` | Compatible | Constructor patching 和 event capture 公开；sampled message details 可能演进。 |
| `captureServiceWorkerIntegration()` | Runtime-dependent | 依赖 service worker availability 和 lifecycle messages。 |
| `captureRuntimeHostIntegration()` | Runtime-dependent | Extension 和 Electron surfaces 是 host-specific，并按 channel 显式 opt-in。 |
| `browserContextPropagationIntegration()` | Stable | Ambient context binding contract 稳定。 |
| `captureProcessIntegration()` | Stable | Node crash/warning/exit capture 和有界 flush 行为是生产承诺。 |
| `diagnosticsChannelIntegration()` | Runtime-dependent | Node channel names 和 payloads 来自 Node 及已 instrumented libraries。 |
| HTTP framework integrations | Compatible | Express/Fastify/Koa/Nest/Hapi adapters 公开；framework lifecycle details 可能调整。 |
| `nodeFetchIntegration()` / `nodeHttpClientIntegration()` | Compatible | Outgoing HTTP capture 公开；Node/undici/http edge details 可能演进。 |
| `captureCliIntegration()` / `serverlessIntegration()` | Compatible | Lifecycle contract 公开；platform-specific invocation metadata 可能细化。 |
| `queueIntegration()` / `bullMqIntegration()` | Compatible | Generic 和 BullMQ operation capture 公开；queue payload metadata 有意可配置。 |
| `databaseIntegration()` / `prismaIntegration()` / `redisIntegration()` | Compatible | Data-client method wrapping 公开；statement/command extraction heuristics 可能演进。 |

## Import Boundaries

Root package imports 是方便入口。Public integration subpaths 被明确记录，用户可以选择更窄 bundles，新内置 integrations 也不能在没有文档时悄悄扩大 surface。

| Runtime | Public integration subpaths |
| --- | --- |
| Browser | `@loggerjs/browser/integration-console`, `@loggerjs/browser/integration-context`, `@loggerjs/browser/integration-errors`, `@loggerjs/browser/integration-fetch`, `@loggerjs/browser/integration-xhr`, `@loggerjs/browser/integration-framework-errors`, `@loggerjs/browser/integration-framework-routers`, `@loggerjs/browser/integration-reporting`, `@loggerjs/browser/integration-router`, `@loggerjs/browser/integration-runtime-host`, `@loggerjs/browser/integration-service-worker`, `@loggerjs/browser/integration-user-actions`, `@loggerjs/browser/integration-websocket`, `@loggerjs/browser/integration-web-vitals`, `@loggerjs/browser/integration-performance`, `@loggerjs/browser/integration-page-lifecycle` |
| Node.js | `@loggerjs/node/integration-process`, `@loggerjs/node/integration-cli`, `@loggerjs/node/integration-koa`, `@loggerjs/node/integration-nest`, `@loggerjs/node/integration-hapi`, `@loggerjs/node/integration-prisma`, `@loggerjs/node/integration-redis`, `@loggerjs/node/integration-queue`, `@loggerjs/node/integration-bullmq`, `@loggerjs/node/integration-serverless`, `@loggerjs/node/integration-database`, `@loggerjs/node/integration-express`, `@loggerjs/node/integration-fastify`, `@loggerjs/node/integration-fetch`, `@loggerjs/node/integration-http-client`, `@loggerjs/node/integration-diagnostics` |

当 public integration subpath 被导出但未列在这里时，`pnpm verify:component-docs` 会失败。新增 entries 也应更新上方稳定性表和该 integration family 的 runtime validation notes。

## Browser / Frontend（`@loggerjs/browser`）

| Integration | 捕获内容 | 说明 |
| --- | --- | --- |
| `captureConsoleIntegration()` | `console.debug/info/log/warn/error/trace` calls | Level allowlist（`levels`）、rate limit（默认 100/s）。Teardown 时恢复 patched methods；console transport 通过 unpatched methods 写出，所以不会循环。 |
| `captureBrowserErrorsIntegration()` | `window.onerror` script/resource errors、`unhandledrejection`、可选 CSP violations | 对快速重复的相同 script errors 做 dedupe。 |
| `captureFetchIntegration()` | 失败（status >= `minStatus`，默认 400）和采样成功的 `fetch` calls | Header allowlists、URL sanitizer。捕获后仍把 errors re-throw 给应用。 |
| `captureXHRIntegration()` | `XMLHttpRequest` lifecycle，带 status 和 duration | 与 fetch 相同的 sanitization options。 |
| `pageLifecycleIntegration()` | 在 `pagehide` / `visibilitychange` 上 flush transports | 合并快速重复 flush；与 HTTP transport 的 beacon mode 搭配。 |
| `captureWebVitalsIntegration()` | CLS、FCP、INP、LCP、TTFB | 通过 PerformanceObserver 发出 incremental 和 final values。 |
| `capturePerformanceIntegration()` | navigation、resource、longtask、measure、mark entries | Deduplicated，并受 `maxEntries` 限制。 |
| `captureUserActionsIntegration()` | clicks、inputs、submits | Per-element throttling；默认不捕获 text/value。 |
| `captureRouterIntegration()` | route changes（`pushState`/`replaceState`/`popstate`/`hashchange`） | 可选 state normalization。 |
| `captureReportingIntegration()` | ReportingObserver reports（CSP、deprecation、intervention、crash） | Teardown 时 drain pending reports。 |
| `captureServiceWorkerIntegration()` | service worker lifecycle、messages、message errors | 默认不捕获 message data。 |
| `captureWebSocketIntegration()` | WebSocket connect/open/close/error 和 sampled messages | 包装 constructor；setup 前创建的 sockets 不会被跟踪。 |
| `captureFrameworkErrorsIntegration()` | React/Vue/Solid/Svelte error hooks | 暴露 `reactComponentDidCatch()`、`vueErrorHandler()` 等；buffer logger 存在前抛出的 errors（`maxPending`）。 |
| `captureRuntimeHostIntegration()` | browser-extension messages、configured channels 上的 Electron IPC | 保守默认：不监控任何 channels。 |
| `browserContextPropagationIntegration()` | session/request/action 和 trace context | 为 traceparent、baggage、session id、request id、recent user action 添加 ambient context providers。 |
| `nextRouterIntegration()` / `reactRouterIntegration()` / `vueRouterIntegration()` / `nuxtRouterIntegration()` | framework router transitions | 常见 router APIs 的 thin adapters；记录前 sanitize URLs。 |

## Node.js / Server（`@loggerjs/node`）

| Integration | 捕获内容 | 说明 |
| --- | --- | --- |
| `captureProcessIntegration()` | `uncaughtException`（fatal）、`unhandledRejection`、warnings、exit | 配置 `exitOnUncaught` 后，捕获 fatal record，调用 `flushSync()`，最多等待 `flushTimeoutMs` 的 async `flush()`，然后以 code `1` 退出。 |
| `diagnosticsChannelIntegration()` | Node `diagnostics_channel` messages（http、undici、custom channels） | 默认不捕获 message payload。 |
| `expressIntegration(logger)` | request completion，带 status、route、duration、request id | 返回 Express middleware；可选 per-request `withContext` binding。 |
| `fastifyIntegration(logger)` | 通过 onRequest/onError/onResponse hooks 捕获 request lifecycle | 返回 Fastify plugin；state 存在 WeakMap 中。 |
| `nodeFetchIntegration()` | outgoing `fetch` calls，带 status 和 duration | 捕获后 errors 会 re-throw。 |
| `nodeHttpClientIntegration()` | `http.request` / `http.get` calls | 捕获 Node http client 生命周期。 |
| `captureCliIntegration()` | CLI start、exit code、SIGINT/SIGTERM | 按 token/password/secret patterns 清洗 argv。 |
| `serverlessIntegration(logger, handler)` | 包装 serverless handler：invocation、duration、cold start、errors | 支持 promise、callback 和 sync handlers。 |
| `queueIntegration()` | queue client operations（publish/consume/ack/nack），带 duration | 按 client 列表 patch 指定 methods。 |
| `databaseIntegration()` | database client calls（query/execute/...），带 statement 和 duration | Statement 从第一个 string arg 或 `.sql`/`.text`/`.query` 属性提取。 |
| `koaIntegration()` / `nestMiddlewareIntegration()` / `hapiIntegration()` | framework request lifecycle | Koa、Express-compatible Nest middleware、Hapi request hooks 的 thin adapters。Nest adapter 不 hook Nest exception filters、interceptors、guards 或原始 thrown `Error`。 |
| `prismaIntegration()` | Prisma raw-query methods | 只包装 `$queryRaw` / `$executeRaw` raw-query variants。不订阅 `$on("query")`，也不捕获 `prisma.user.findMany()` 这类 typed model operations。 |
| `redisIntegration()` | Redis command methods | 捕获 selected command methods、duration、errors 和可选 payload metadata。 |
| `bullMqIntegration()` | BullMQ Queue method calls | 包装 `add`、`addBulk` 和存在时的 legacy `process` method。不 hook `Worker` 或 `QueueEvents` 的 `completed`、`failed`、`stalled` 等 lifecycle events。 |

### Context manager

这不是 integration，但也是启动时安装一次：

```ts
import { installAsyncLocalStorageContext } from "@loggerjs/node";
installAsyncLocalStorageContext();
```

之后 `withContext()` 的值会跨 `await` 边界跟随 async execution。

## 编写自定义 Integration

```ts
import type { Integration } from "@loggerjs/core";

export function captureThingIntegration(): Integration {
  return {
    name: "thing",
    setup(api) {
      const original = thing.onEvent;
      const capture = api.guard((payload: unknown) => {
        api.capture({
          level: "info",
          message: "thing event",
          data: { payload },
        });
      });

      thing.onEvent = (payload) => {
        capture(payload);
        return original(payload);
      };

      return () => {
        thing.onEvent = original;
      };
    },
  };
}
```

setup context（`api`）提供：

- `capture(input)`：主要入口；打上 `source: "integration:thing"`。
- `log/trace/debug/info/warn/error/fatal/event/captureException`：当 capture semantics 不合适时使用的直接 logging methods。
- `guard(fn)`：用 re-entrancy counter 包装 callback。如果 patched surface 本身被 logging pipeline 触发（典型情况：console capture + console transport），递归调用会被丢弃并计入 meta（`integration.dropped.reentrant`），而不是无限递归。
- `unpatched`：原始 `console.*` / `fetch` / `XMLHttpRequest` 实现的注册表，在所有 integrations 间共享，让 double patching 可以组合。
- `flush/flushSync/close`：供 page hide 等 lifecycle-driven integrations 使用。

规则：

- 始终返回 teardown，恢复你 patch 的内容。Teardowns 在 `logger.close()` 时运行一次，并按 setup 反向顺序执行。
- Setup 对每个 integration _instance_ 是幂等的；创建两个 instances 就会 patch 两次。导出 factory 并写清楚。
- 优雅降级：feature-detect 平台表面，不存在时 no-op。
- 捕获原始结构化数据，让 processors 负责 redact；不要提前格式化 messages。
