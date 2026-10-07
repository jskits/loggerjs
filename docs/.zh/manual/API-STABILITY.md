# API 稳定性

LoggerJS 仍处于 1.0 之前的阶段。仓库中的 `api-reports/` 文件记录了每一个导出的 TypeScript 声明，但这并不表示每个导出符号都已经作为 v1 API 冻结。

本页是写给人看的稳定性约定。机器可读的分级位于 [`docs/api-stability.policy.json`](https://github.com/jskits/loggerjs/blob/main/docs/api-stability.policy.json)；如果某个包的导出没有列入该文件，`pnpm verify:api-stability` 会失败。

## 当前策略

在 v1 之前，项目选择收窄兼容承诺，而不是冻结整个仓库。稳定范围被有意限定为一个内核：core 的 logger 模型和管线契约、主要的浏览器和 Node 投递路径、主要的浏览器采集 integration、Node 进程采集与 context，以及 pretty 输出。v1 冻结应当在早期合作用户把这个内核真正跑在生产环境、并根据实际使用情况裁剪其余部分之后进行，而不是之前。

其他部分同样可能是公开的、经过测试且可用的，但并非都属于 v1 兼容承诺。尤其是厂商、可观测性和数据库相关的包，在获得更多真实使用和故障场景验证之前，仍保持实验状态。

## 状态分级

| 状态 | 含义 |
| --- | --- |
| Stable v1 Candidate | 计划原样带入 v1：不删除、不重命名、不破坏签名，安全、数据丢失或线上协议正确性修复除外。允许新增。 |
| Compatible Public Surface | 公开且有测试，但还没有稳定到 v1 候选的程度。v1 之前的 minor 版本可能调整选项名、采集字段或运行时边界行为，并在发布说明中注明。 |
| Experimental Before v1 | 公开的包或子路径，在 v1 之前可能变化。当前行为满足需求时可以使用，但不要把它们当作已冻结的兼容契约。 |

内部源码路径、`dist` 文件路径、生成的 bundle 结构、私有类字段，以及只能从测试中推断出的行为，在任何状态下都不属于公开 API。

## Stable v1 Candidate

稳定的导出记录在 `api-stability.policy.json` 中。当前稳定的包和入口如下：

| 包 | 稳定范围 |
| --- | --- |
| `@loggerjs/core` | 根入口内核（`createLogger`/`Logger`、`getLogger`/`configure`、级别、类型、record 与 event 转换、环境 context、类型化事件、middleware、meta 计数器、错误与安全序列化工具、JSON codec，以及 console、memory、batch、reliability transport），以及 `middleware`、`codec-json`、`context`、`events`、`transport-console`、`transport-batch`、`transport-reliability` 子路径。 |
| `@loggerjs/browser` | `transport-http`、`offline-indexeddb`、`transport-indexeddb`、`offline-first-transport`，以及 console、error、context、page-lifecycle integration。 |
| `@loggerjs/node` | `transport-stdout`、`transport-file`、`transport-rotating-file`、`transport-http`、`integration-process`，以及 AsyncLocalStorage `context`。 |
| `@loggerjs/pretty` | 根入口、formatter、console transport 和 stream transport。 |

稳定的语义包括：

- 用于应用日志和对库友好日志的 `createLogger(options)`、`getLogger(category)` 和 `configure(...)`。
- Logger 实例方法：`trace`、`debug`、`info`、`warn`、`error`、`fatal`、`log`、`capture`、`event`、`child`、`withTags`、`withType`、`setLevel`、`getLevel`、`isEnabled`、`isLevelEnabled`、`addTransport`、`addProcessor`、`addIntegration`、`ready`、`flush`、`flushSync` 和 `close`。
- 级别名称和数值：`trace=10`、`debug=20`、`info=30`、`warn=40`、`error=50`、`fatal=60` 以及 `silent`。
- `Middleware`、`Processor`、`Transport`、`Integration`、`Codec` 这些管线接口，包括 `TransportContext.toEvent(record)` 的缓存投影。
- 禁用的级别会在分配 record 和计算延迟消息之前返回。
- middleware、processor、codec、integration 和 transport 的错误与应用代码隔离。
- 序列化仍由 transport 负责；middleware 和 processor 处理的始终是结构化的值。

## Compatible Public Surface

Compatible 的导出同样有文档和测试，但还没有稳定到 v1 候选的程度。当前属于 Compatible 的部分包括：

- 将在 1.0 移出根入口的 core 模块：`@loggerjs/core/trace-propagation`、`semantic-events`、`payload-transforms`、`diagnostics`、`integration-api`、`event-route`、`codec-metrics`、`codec-prepared` 和 `transport-test`。它们在 `@loggerjs/core` 根入口的 re-export 从 0.7 起标为 deprecated，并在 1.0 删除；请改从这些子路径导入。`pnpm verify:api-stability` 只允许根入口通过 deprecated 的导出项转导出稳定性更低的模块。
- browser 和 node 的根入口（`@loggerjs/browser`、`@loggerjs/node`）属于 Compatible 的便捷聚合入口，因为它们同时重新导出了稳定和 Compatible 的组件。需要 v1 候选级别的兼容边界时，请优先使用上面列出的稳定子路径。从 0.7 起，它们对 compatible 组件的 re-export 已标为 deprecated；1.0 起根入口只导出 core 内核和 browser 或 Node 的 stable 组件，并成为 stable。请改从子路径导入 compatible 组件（见迁移说明）。
- 浏览器的次要 transport 和采集器：BroadcastChannel、service worker、WebSocket、框架错误、框架路由、通用路由采集、ReportingObserver、运行时宿主、service worker 消息、用户操作和 WebSocket 采集。
- 浏览器的 fetch/XHR 采集、web vitals、performance 条目、压缩 payload 转换和支持日志 ZIP 导出。
- Node 的 syslog 和 worker transport、压缩 payload 转换、出站 fetch/HTTP client 采集、diagnostics_channel 采集和 logger 诊断。
- Node 的框架和数据类 integration：Express、Fastify、Koa、Nest、Hapi、Prisma、Redis、通用队列、BullMQ、serverless 生命周期、数据库方法包装和 CLI 采集。
- `@loggerjs/processors` 和 `@loggerjs/codecs` 目录。单个 processor 和 codec 都很小也很有用，但在真实使用表明哪些真正重要之前冻结约一百个导出，只会锁定错误的那部分。

在 1.0 之前，这些公开的导入路径会继续保留，但具体的采集字段、钩子覆盖范围和边界行为仍可能调整。如果真实使用表明当前 API 过于宽泛，这些部分也是 v1 之前收窄命名或降低承诺的合适位置。

## Experimental Before v1

以下包之所以公开，是因为它们对集成测试和早期使用者有用，但它们不属于 v1 兼容承诺：

| 包类别 | 实验性导出 |
| --- | --- |
| 可观测性适配器 | `@loggerjs/otel/*`, `@loggerjs/sentry/*` |
| 厂商协议 transport | `@loggerjs/datadog/*`, `@loggerjs/elastic/*`, `@loggerjs/loki/*`, `@loggerjs/cloudwatch/*` |
| 数据库 transport | `@loggerjs/database/*` |

实验性不等于没有测试。它的意思是：如果早期合作用户或真实端点表明有更好的设计，v1 之前的 minor 版本可能调整选项名、payload 映射、重试预期、批量建议或子路径结构。

原始的厂商 transport 本身不具备持久性。生产投递应使用 `batchTransport()` 和 `retryTransport()` 包装，或者投递到一个自己负责排队、重试、认证和退避的收集端点。

## TypeScript 签名之外的契约

`api-reports/` 只能看到 TypeScript 声明。以下契约改由测试保护：

- **线上格式。** codec 输出、logger 产出的事件结构，以及 Node 和浏览器 transport 发出的完整 HTTP 请求，都由 `packages/*/test/golden/` 下的 golden 文件逐字节固定。改动它们就是线上协议变更，适用与所属 API 签名变更相同的策略。
- **浏览器持久化数据。** `indexedDbTransport()` 和 `indexedDbBrowserHttpOfflineQueue()` 的 IndexedDB 结构必须能被下一个版本读取。`tests/e2e/browser-upgrade.spec.ts` 用上一个已发布版本写入数据，再用当前代码读取。
- **进程共享状态。** 使用 `configure({ shareAcrossCopies: true })` 时，同一进程中加载的所有 `@loggerjs/core` 副本（ESM 与 CJS 构建，或两个已安装的版本）共用存放在 `Symbol.for("@loggerjs/core/shared-state/v1")` 下的 registry、环境 context 和 meta 计数器；否则各副本保持隔离。registry 中的 logger 由调用 `configure()` 的副本创建，因此该副本的诊断 sink 能看到所有这些 logger。同一构建的子路径入口始终通过共享 chunk 共享状态。只有该状态的结构发生不兼容变化时才会修改 `v1` 后缀，这属于破坏性变更。整个 1.x 期间默认都保持隔离：库的日志缺失时会有警告，一行配置即可解决；而默认共享会让一个微前端的 `configure()` 替换另一个的配置并关闭它的 transport。无论往哪个方向修改默认值，都属于破坏性变更。
- **投递计数。** 交给第一方 transport 的每个事件，要么被投递，要么通过 `onDrop` 和 `transport.dropped.*` 计数器报告；即使目标端出错，`flush()`/`close()` 也必须结束。故障注入测试、基于模型的测试和浸泡测试都会断言这一不变量。

## 变更策略

对于 Stable v1 Candidate API：

- v1 之前不会有意删除、重命名或破坏签名，除非同时提供弃用说明和迁移路径。
- 允许新增：新的选项、字段、重载、processor、transport、integration 和子路径。
- 影响投递、隐私或性能的默认值变化，需要更新文档并写入发布说明。
- 安全修复、数据丢失修复和厂商线上协议正确性修复可能改变边界情况下的行为，发布说明中必须写明。

对于 Compatible 和 Experimental API：

- 公开导出仍然保持类型检查、测试、API 报告和文档齐全。
- v1 之前的 minor 版本可以调整名称、选项、字段结构或具体行为。
- 破坏性变更仍应附带发布说明和迁移指南，因为“公开”不等于“可以随意丢弃”。

## 1.0 之后的 SemVer

从 1.0 开始，一个包的语义化版本保证只覆盖其中的 Stable 导出。其他层级在 1.x 包里保持各自的规则：

- **Stable：** 同一个 major 内不删除、不重命名、不破坏签名。新增内容在 minor 中发布。除安全、数据丢失或线上协议正确性修复外，行为变化需要发 major。
- **Compatible：** 只有在更早的 minor 已将其标为 `@deprecated` 并给出迁移路径之后，后续 minor 才能修改该导出，且发布说明必须写明。
- **Experimental：** 这些包在升级前一直停留在 0.x，因此其 minor 可以修改任何内容，但需附带发布说明。

把剩余的 compatible 组件拆成独立的包，可以消除 `@loggerjs/browser` 和 `@loggerjs/node` 内部的分层，但在 1.0 之前代价太大。

## 1.0 的版本策略

- `@loggerjs/core`、`@loggerjs/browser`、`@loggerjs/node` 和 `@loggerjs/pretty` 承载 stable 内核。它们一起升到 1.0，并组成 Changesets 的 `linked` 组，版本号同步变化，用户不需要对照兼容表。
- `@loggerjs/processors` 和 `@loggerjs/codecs` 留在 0.x，直到 design partner 的使用情况表明哪些 processor 和 codec 值得保留。在 1.0 冻结它们的目录，等于承诺了尚未经过验证的稳定性。
- `@loggerjs/otel`、`@loggerjs/sentry`、`@loggerjs/datadog`、`@loggerjs/elastic`、`@loggerjs/loki`、`@loggerjs/cloudwatch` 和 `@loggerjs/database` 作为 experimental 留在 0.x，按各自的节奏发版。
- 从 1.0 开始，除 core 外的所有包都把 `@loggerjs/core` 声明为 peer dependency，让一个应用只安装一份 core，前面提到的多副本问题只会出现在真正彼此独立的 bundle 之间。内核包使用 `^1.0.0`；0.x 的包接受 `^0.7.0 || ^1.0.0`，这样这次调整不会把它们强行升到 1.0。

## 新增公开 API

新增包导出时必须：

1. 在尽可能贴近真实运行时的层级新增或更新测试。
2. 更新文档和示例，说明导入边界和注意事项。
3. 把新导出加入 `docs/api-stability.policy.json`。
4. 运行 `pnpm verify:api-stability` 和 `pnpm api:check`。

如果现有的稳定 API 已经能解决问题，优先提供示例和组合方式，而不是新增导出。

## 如何评估未来的升级

1. 阅读包的 changelog 和发布说明。
2. 查看本页和 `api-stability.policy.json`，确认你依赖的导出属于哪个状态。
3. 如果你是贡献者，在本仓库运行 `pnpm check`；如果你是使用者，运行你自己应用的测试套件。
4. 对热路径，用 `pnpm bench:node` 或 `pnpm bench:browser` 复现相关的基准。
5. 对远程投递，测试你真实使用的收集端或厂商端点，并监控 `transport.dropped.*`、`transport.retry.*` 以及队列深度指标。
