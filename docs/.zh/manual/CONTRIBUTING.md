# 贡献

## 设置

```bash
pnpm install   # 仓库开发需要 Node >=22.13、pnpm >= 11.5.3
pnpm check     # 完整门禁，push 前运行
```

`pnpm check` 与 CI 在每个 pull request 上运行的门禁相同：格式检查（oxfmt）、lint（oxlint）、类型检查、测试（vitest）、构建（rolldown + tsc）、体积预算、导出映射校验、公开类型检查、API 报告检查和 npm 打包校验。CI 还会额外运行 `pnpm bench:gate`。

## Node 版本策略

- **仓库开发**：使用 Node `>=22.13.0`。根目录 `package.json` 的 `engines` 字段和本地工具链都以此为下限。
- **完整 CI 门禁**：在 Node 22 和 24 上运行 `pnpm check`，发布构建使用 Node 24。
- **已发布包的运行时兼容性**：打包后的产物会以消费方身份在 Node 22.0.0、最新的 Node 22 和 Node 24 上做冒烟测试。Node 22.0.0 是 Node 使用者的运行时兼容下限，但并不会降低仓库开发工具链的要求。

## 仓库布局

```text
packages/core         platform-neutral kernel: logger, record/event model, registry,
                      context, middleware, integration API, console/memory/test/batch/
                      retry/fallback transports, json/safe-json/ndjson/metrics codecs
packages/browser      browser transports + integrations
packages/node         node transports + integrations + AsyncLocalStorage context
packages/processors   middleware/processor toolbox
packages/codecs       fast-event-json, pino-compat, msgpackr, projector
packages/pretty       browser DevTools and terminal pretty output
packages/otel|sentry|datadog|elastic|loki|cloudwatch|database   destination adapters
examples/             runnable examples per platform
scripts/              build/verify/bench/release tooling
docs/                 this documentation
api-reports/          checked-in public API surface per package
```

Turbo 负责带缓存地编排 `build`/`test`/`typecheck`；可以用 `pnpm exec turbo run test --filter=...@loggerjs/core` 只运行某个包及依赖它的包。

## 会让 CI 失败的规则

**提交信息** 遵循 Conventional Commits，由 commitlint 强制检查。允许的 scope：`browser`、`build`、`codecs`、`core`、`deps`、`docs`、`examples`、`node`、`otel`、`processors`、`release`、`repo`。

**API 报告**：任何公开 API 的变更（包括导出符号上的 JSDoc）都需要运行 `pnpm build && pnpm api:report` 重新生成报告并提交差异。报告与代码不一致时 `pnpm api:check` 会失败。

**体积预算**（`scripts/check-size-budgets.mjs`）：每个包入口在构建后都会检查原始体积和 gzip 体积上限，大多数用户起步用的最小应用（`createLogger()` 搭配 `consoleTransport()`、`browserHttpTransport()` 或 `stdoutTransport()`，经过 tree-shaking 和压缩）也一样。只有在同一个或相邻的提交中写明实测体积和理由时，才能上调预算。

**线上格式 golden 文件**（`packages/*/test/golden/`）：codec 输出、logger 的事件结构，以及 Node 和浏览器 transport 发出的完整 HTTP 请求都被逐字节固定。这里出现 diff，就意味着所有解析这些日志的人都会受到线上协议变更的影响：先审查，再在对应包里用 `pnpm exec vitest run -u` 更新。golden 目录不参与格式化和换行符转换。

**包清单**（`pnpm pack:check`）：内部依赖使用 `workspace:^`，每个包声明的 `engines.node` 必须与 `ci.yml` 中 node-compat 矩阵的最低 Node 版本一致。

**组件文档**（`scripts/verify-component-docs.mjs`）：每个公开的 `transport-*`、`*-transport` 或 `integration-*` 子路径都必须出现在对应的 transport/integration 导入边界文档中。新组件还需要在同一次变更中补充稳定性和可靠性说明。

**基准门禁**（`pnpm bench:gate`）：热路径场景以配对 A/B 比值与对应的 pino 基线比较。阈值有意放宽，用来发现结构性回归（例如每条日志多了一次意外分配、快速路径失效），而不是普通噪声。如果你的变更合理地改变了比值，请在 `scripts/check-bench-regression.mjs` 中更新阈值并说明理由。

**Changesets**：对已发布包的用户可见变更需要添加 changeset（`pnpm changeset`）；纯仓库工具的改动不需要。

## 工程约定

- **core 保持平台无关**：不使用 DOM 类型和 Node 内置模块，通过 `globalThis` 做特性检测。公开类型必须在没有 `lib.dom` 的情况下也能编译。
- **优先求稳，而不是扩大 API**：先加固现有的 transport 和 integration。新增内置组件需要有生产用例、放在合适的运行时包中，并附带测试、稳定性文档、导入边界文档和体积预算数据。
- **管线永远不向应用抛错。** middleware、processor、codec 和 transport 都做了错误隔离，失败通过 `onInternalError` 和 meta 计数上报。新代码必须保持这一点。
- **codec 不得丢日志**：对有风险的编码做保护，失败时回退到 `safeJsonStringify`，并在 meta 中计数。
- **共享对象被冻结，只能替换，不能原地修改**（`record.tags`、`record.ctx`）。
- **热路径变更要用数据说话。** 修改前后各运行一次 `pnpm bench:node`，把相关结果写进提交信息；快照有明显变化时更新 `docs/BENCHMARKS.md`。基准预热次数必须与迭代次数成比例，详见 [基准](BENCHMARKS.md) 中关于预热的说明。
- **性能优化有明确边界**：在提议绕过 record 的快速路径之前，先阅读 [架构](ARCHITECTURE.md) 中关于 record 管线的决策。

## 测试

各包使用 Vitest，测试文件位于 `test/*.test.ts`。仓库约定：

- 用刁钻的输入固定行为（循环引用、BigInt、冻结对象、会抛错的回调），大多数回归问题都是靠这类测试发现的。
- 在 transport 侧做断言时使用 `@loggerjs/core/transport-test` 的 `testTransport()`，它提供快照、统计和 `waitForCount`。
- 新的 transport/integration 要附带拆除测试：patch、采集、恢复，然后断言没有重复采集。

其他 CI 门禁覆盖运行时和质量方面：

- `pnpm test:e2e:browser` 在 Chromium、Firefox 和 WebKit 中运行浏览器 E2E 测试。
- `pnpm compat:runtimes -- --runtime=bun|deno|workers` 在 Bun、Deno 和 workerd/Miniflare 中对打包产物做冒烟测试。
- `pnpm test:quality` 运行覆盖率阈值检查、变异测试、并发管线浸泡测试，以及 transport 浸泡测试（`pnpm test:soak:transports`：file、rotating-file 和 HTTP 投递，收集端会注入 503、连接重置和挂起请求）。每晚的 `Soak` workflow 会把两者各运行 20 分钟；发版前可手动触发并设置更长时长。
- 投递相关代码要在注入故障的情况下测试，而不只是正常路径，并断言守恒不变量：每个发出的事件要么被投递，要么通过 `onDrop` 和 `transport.dropped.*` 计数器报告，且 `flush()`/`close()` 必须结束。优先使用真实故障（把目录或 `/dev/full` 当作文件目标、会返回 503/重置连接/永不响应的真实 HTTP 收集端、`context.setOffline()`、CDP 配额覆盖），而不是模拟的流。
- 生命周期相关改动（flush、close、configure、重试）需要保持 `packages/core/test/lifecycle-model.test.ts` 通过；它用带种子的随机操作序列驱动不稳定的 transport，失败时测试名里的种子可以复现。
- `tests/e2e/browser-upgrade.spec.ts` 用当前代码打开上一个已发布版本（`examples/browser-basic` 中的 `@loggerjs/browser-previous`）写入的 IndexedDB 数据。
- CI 中的 `windows` job 会在 Windows 上运行 core 和 Node 测试。
- `pnpm test:live:local` 启动基于 Docker 的 Elasticsearch 和 Loki 实例，通过 transport 写入真实日志，再从服务中查询确认。
- `pnpm test:live:external` 向 Datadog Logs 和 CloudWatch Logs 写入并查询日志，需要 `DATADOG_API_KEY`、`DATADOG_APP_KEY`、`AWS_REGION`、`AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY` 和 `CLOUDWATCH_LOG_GROUP`；`pnpm test:live:config` 可以在不打印密钥值的情况下检查哪些变量已设置。

## 发布

见 [发布](RELEASE.md)。简要流程：changesets 在 `main` 上累积；维护者运行 `pnpm version-packages` 并提交结果，然后推送 `v*` tag，由 release workflow 运行完整门禁并带 provenance 发布。
