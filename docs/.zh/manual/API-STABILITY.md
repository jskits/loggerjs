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
| `@loggerjs/core` | 根入口，以及文档中列出的 middleware、codec、events、context、trace 传播、payload 转换和 core transport 子路径。 |
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

- browser 和 node 的根入口（`@loggerjs/browser`、`@loggerjs/node`）属于 Compatible 的便捷聚合入口，因为它们同时重新导出了稳定和 Compatible 的组件。需要 v1 候选级别的兼容边界时，请优先使用上面列出的稳定子路径。
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
