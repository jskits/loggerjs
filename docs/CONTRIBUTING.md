# Contributing

## Setup

```bash
pnpm install   # repository development uses Node >=22.13, pnpm >= 11.5.3
pnpm check     # the full gate — run before pushing
```

`pnpm check` is the same gate CI runs on every pull request: format check (oxfmt), lint (oxlint), typecheck, tests (vitest), builds (rolldown + tsc), size budgets, export map verification, public type surface check, API report check, and npm pack validation. CI additionally runs `pnpm bench:gate`.

## Node Version Policy

- **Repository development:** use Node `>=22.13.0`. The root `package.json` `engines` field and local tooling are intentionally set to this floor.
- **Full CI gate:** runs `pnpm check` on Node 22 and 24, with releases built on Node 24.
- **Published package runtime compatibility:** packed packages are smoke-tested as consumers on Node 20.19.0, 22, and 24. Node 20.19.0 is the runtime compatibility floor for Node consumers; it does not lower the repo development toolchain requirement.

## Repository Layout

```
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

Turbo orchestrates `build`/`test`/`typecheck` with caching; scope work with `pnpm exec turbo run test --filter=...@loggerjs/core` (the package and its dependents).

## Rules That Fail CI

**Commits** follow Conventional Commits, enforced by commitlint. Allowed scopes: `browser`, `build`, `codecs`, `core`, `deps`, `docs`, `examples`, `node`, `otel`, `processors`, `release`, `repo`.

**API reports**: any public-surface change (including JSDoc on exported symbols) requires regenerating reports — `pnpm build && pnpm api:report` — and committing the diff. `pnpm api:check` fails on drift.

**Size budgets** (`scripts/check-size-budgets.mjs`): every package entry has raw + gzip ceilings checked after build, and so do the tree-shaken, minified minimal apps most users start with (`createLogger()` plus `consoleTransport()`, `browserHttpTransport()`, or `stdoutTransport()`). Raise a budget only together with the change that justifies it, in the same or an adjacent commit, with the measured size and the reason in the message.

**Wire-format golden files** (`packages/*/test/golden/`): codec output, the logger's event shape, and the exact HTTP requests the Node and browser transports send are pinned byte for byte. A diff there is a wire-protocol change for everyone parsing the logs: review it, then update with `pnpm exec vitest run -u` in the package. The golden directories are excluded from formatting and line-ending conversion.

**Component docs** (`scripts/verify-component-docs.mjs`): every public `transport-*`, `*-transport`, or `integration-*` subpath must be listed in the matching transport/integration import-boundary docs. New components also need stability and reliability notes in the same change.

**Benchmark gate** (`pnpm bench:gate`): hot-path scenarios are limited as paired A/B ratios against the matching pino baseline. Limits are generous — they catch structural regressions (an accidental allocation per log, a dropped fast path), not noise. If your change legitimately shifts a ratio, update the limits in `scripts/check-bench-regression.mjs` with justification.

**Changesets**: user-facing changes to published packages need a changeset (`pnpm changeset`); pure repo tooling does not.

**Package manifests** (`pnpm pack:check`): internal dependencies use `workspace:^`, and every package declares `engines.node` matching the lowest Node version in the `ci.yml` node-compat matrix.

## Engineering Conventions

- **Core stays platform-neutral**: no DOM types, no Node built-ins, feature-detect via `globalThis`. The public type surface must compile without `lib.dom`.
- **Prefer stabilization over surface expansion before v1**: harden existing transports/integrations first. A new built-in component needs a production use case, runtime-appropriate package placement, tests, stability docs, import-boundary docs, and size-budget evidence.
- **The pipeline never throws into the app.** Middleware, processors, codecs, and transports are error-isolated; failures report through `onInternalError` and meta counters. New code keeps that property.
- **Codecs must not lose logs**: wrap risky encodes and fall back to `safeJsonStringify`; count fallbacks in meta.
- **Shared objects are frozen, replaced not mutated** (`record.tags`, `record.ctx`).
- **Hot-path changes need numbers.** Run `pnpm bench:node` before/after and put the relevant line in the commit message; update `docs/BENCHMARKS.md` when the snapshot moves materially. Benchmark warmup must stay proportionate to iterations — see the warmup note in [BENCHMARKS.md](BENCHMARKS.md).
- **Performance has a documented boundary**: read the record-pipeline decision in [ARCHITECTURE.md](ARCHITECTURE.md) before proposing a record-bypassing fast path.

## Tests

Vitest per package, `test/*.test.ts`. House style:

- Pin behavior with hostile inputs (circular refs, BigInt, frozen objects, throwing callbacks) — most past regressions were caught by exactly these.
- Use `testTransport()` from `@loggerjs/core/transport-test` for transport-side assertions; it provides snapshots, stats, and `waitForCount`.
- New transports/integrations ship with teardown tests: patch, capture, restore, assert no double-capture.
- Delivery code is tested against injected failures, not only the happy path, and asserts the conservation invariant: every emitted event is delivered, or reported through `onDrop` and the `transport.dropped.*` counters, and `flush()`/`close()` settle. Prefer real failures (a directory or `/dev/full` as a file target, a real HTTP collector that answers 503, resets, or never answers, `context.setOffline()`, a CDP quota override) over mocked streams. See `packages/node/test/failure-injection.test.ts`, `packages/node/test/http-failure-injection.test.ts`, and `tests/e2e/browser-failures.spec.ts`.
- Lifecycle changes (flush, close, configure, retries) should keep `packages/core/test/lifecycle-model.test.ts` green; it runs seeded random operation sequences against flaky transports. When it fails, the seed in the test name replays the run.

Additional CI gates cover the runtime and quality surface:

- `pnpm test:e2e:browser` runs the browser E2E suite in Chromium, Firefox, and WebKit.
- `pnpm compat:runtimes -- --runtime=bun|deno|workers` smoke-tests the packed packages in Bun, Deno, and a workerd/Miniflare runtime.
- `pnpm test:quality` runs coverage thresholds, mutation testing, the concurrent pipeline soak, and the transport soak (`pnpm test:soak:transports`: file, rotating-file, and HTTP delivery against a collector that injects 503s, resets, and hung requests). The nightly `Soak` workflow runs both for 20 minutes; dispatch it manually with a longer duration before a release.
- `tests/e2e/browser-upgrade.spec.ts` opens IndexedDB data written by the previous published release (`@loggerjs/browser-previous` in `examples/browser-basic`) with the current code.
- The `windows` CI job runs the core and Node suites on Windows.
- `pnpm test:live:local` starts Docker-backed Elasticsearch and Loki instances, writes real log events through the transports, and queries those services back.
- `pnpm test:live:external` writes to and queries Datadog Logs and CloudWatch Logs. It requires `DATADOG_API_KEY`, `DATADOG_APP_KEY`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `CLOUDWATCH_LOG_GROUP`; use `pnpm test:live:config` to audit which variables are present without printing secret values.

## Releasing

See [RELEASE.md](RELEASE.md). Short version: changesets accumulate on `main`; a maintainer runs `pnpm version-packages` and commits the result, then pushes a `v*` tag, and the release workflow runs the full gate and publishes with provenance.
