# 贡献

## 设置

```bash
pnpm install   # repository development uses Node >=22.13, pnpm >= 11.5.3
pnpm check     # 完整门禁，push 前运行
```

`pnpm check` 与 CI 在每个 pull request 上运行的门禁一致：format check（oxfmt）、lint（oxlint）、typecheck、tests（vitest）、builds（rolldown + tsc）、size budgets、export map verification、public type surface check、API report check 和 npm pack validation。CI 还会额外运行 `pnpm bench:gate`。

## Node 版本策略

- **仓库开发**：使用 Node `>=22.13.0`。root `package.json` 的 `engines` 字段和本地工具链有意设定在这个下限。
- **完整 CI 门禁**：在 Node 22 和 24 上运行 `pnpm check`，release 使用 Node 24 构建。
- **发布包 runtime 兼容性**：packed packages 会作为 consumer 在 Node 20.19.0、22 和 24 上做 smoke test。Node 20.19.0 是 Node 消费者 runtime 兼容下限；它不降低仓库开发工具链要求。

## 仓库布局

```text
packages/core         platform-neutral kernel: logger, record/event model, registry,
                      context, middleware, integration API, console/memory/test/batch
                      transports, json/safe-json/ndjson codecs
packages/browser      browser transports + integrations
packages/node         node transports + integrations + AsyncLocalStorage context
packages/processors   middleware/processor toolbox
packages/codecs       fast-event-json, built-in msgpackr, projector
packages/otel|sentry|datadog|elastic|loki|cloudwatch|database   destination adapters
examples/             runnable examples per platform
scripts/              build/verify/bench/release tooling
docs/                 this documentation
api-reports/          checked-in public API surface per package
```

Turbo 用缓存编排 `build`/`test`/`typecheck`；可以用 `pnpm exec turbo run test --filter=...@loggerjs/core` 按包和依赖它的包缩小范围。

## 会让 CI 失败的规则

**Commits** 遵循 Conventional Commits，并由 commitlint 强制。允许 scopes：`browser`、`build`、`codecs`、`core`、`deps`、`docs`、`examples`、`node`、`otel`、`processors`、`release`、`repo`。

**API reports**：任何 public surface 变更（包括 exported symbols 上的 JSDoc）都需要重新生成 reports：`pnpm build && pnpm api:report`，并提交 diff。`pnpm api:check` 会在漂移时失败。

**Size budgets**（`scripts/check-size-budgets.mjs`）：每个包都有 build 后检查的 raw + gzip 上限。只有在同一个或相邻 commit 中随理由一起提交时，才提高预算。

**Component docs**（`scripts/verify-component-docs.mjs`）：每个 public `transport-*`、`*-transport` 或 `integration-*` subpath 都必须出现在匹配的 transport/integration import-boundary docs 中。新组件还需要在同一变更中补稳定性和可靠性说明。

**Benchmark gate**（`pnpm bench:gate`）：热路径场景以 paired A/B ratios 与匹配的 pino baseline 比较。限制故意宽松，用来抓结构性回归（每条日志意外分配、fast path 丢失），不是抓普通噪声。如果你的变更合理改变了 ratio，在 `scripts/check-bench-regression.mjs` 中带理由更新限制。

**Changesets**：发布包的用户可见变更需要 changeset（`pnpm changeset`）；纯仓库工具改动不需要。

## 工程约定

- **Core 保持平台中立**：无 DOM types、无 Node built-ins，通过 `globalThis` 做 feature-detect。Public type surface 必须能在没有 `lib.dom` 的环境下编译。
- **v1 前优先稳定而不是扩 surface**：先加固现有 transports/integrations。新增内置组件需要生产用例、合适的 runtime package placement、测试、稳定性文档、import-boundary docs 和 size-budget evidence。
- **管线永远不向应用抛错。** Middleware、processors、codecs 和 transports 都错误隔离；失败通过 `onInternalError` 和 meta counters 上报。新代码要保持这个性质。
- **Codecs 不得丢日志**：包住风险 encode，并 fallback 到 `safeJsonStringify`；在 meta 中计数 fallback。
- **共享对象冻结，替换而非修改**（`record.tags`、`record.ctx`）。
- **热路径变更需要数字。** 前后运行 `pnpm bench:node`，把相关行写进 commit message；当快照有实质变化时更新 `docs/BENCHMARKS.md`。Benchmark warmup 必须与 iterations 成比例，详见 BENCHMARKS.md 中关于曾经做错 warmup 的说明。
- **性能有文档化边界**：提出绕过 record 的 fast path 前，先阅读 [架构](ARCHITECTURE.md) 中 record-pipeline 决策。

## 测试

各包使用 Vitest，测试在 `test/*.test.ts`。仓库风格：

- 用 hostile inputs 固定行为（circular refs、BigInt、frozen objects、throwing callbacks）。多数历史回归正是这样被抓到的。
- 用 core 的 `testTransport()` 做 transport-side assertions；它提供 snapshots、stats 和 `waitForCount`。
- 新 transports/integrations 要带 teardown tests：patch、capture、restore，再断言没有 double-capture。

额外 CI gates 覆盖 runtime 和质量面：

- `pnpm test:e2e:browser` 在 Chromium、Firefox 和 WebKit 中运行 browser E2E suite。
- `pnpm compat:runtimes -- --runtime=bun|deno|workers` 在 Bun、Deno 和 workerd/Miniflare runtime 中 smoke-test packed packages。
- `pnpm test:quality` 运行 coverage thresholds、mutation testing 和 concurrent soak runner。
- `pnpm test:live:local` 启动 Docker-backed Elasticsearch 和 Loki 实例，通过 transports 写入真实 log events，并查询服务确认。
- `pnpm test:live:external` 写入并查询 Datadog Logs 和 CloudWatch Logs。它需要 `DATADOG_API_KEY`、`DATADOG_APP_KEY`、`AWS_REGION`、`AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY` 和 `CLOUDWATCH_LOG_GROUP`；使用 `pnpm test:live:config` 可以在不打印 secret values 的情况下审计当前变量。

## 发布

见 [发布](RELEASE.md)。简版：changesets 在 `main` 上累计；release workflow 负责 version、build、运行完整门禁，并带 provenance 发布。
