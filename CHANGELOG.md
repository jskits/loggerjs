# Changelog

This changelog is organized by git tag. Package-specific changelogs live in
`packages/*/CHANGELOG.md`.

## Unreleased

Source range: `v0.5.0..HEAD`.

### Changed

- Tightened `@loggerjs/core` so its source and public type surface compile
  without DOM lib types.
- Classified existing transports and integrations by stability level.
- Split `@loggerjs/browser` and `@loggerjs/node` transport/integration subpaths
  into physical entry bundles and added entry-boundary verification.
- Added a component-documentation gate so future public transport/integration
  subpaths must appear in the import-boundary docs.
- Clarified the Node policy: repository development uses Node >=22.13, while
  published package runtime compatibility is smoke-tested from Node 20.19.0.
- Refreshed the README and public documentation generated for LLM entry points.

### Tests

- Added real-browser E2E coverage for IndexedDB offline queue replay across
  reload, pagehide `sendBeacon`, and service worker delivery.
- Strengthened live integration readiness reporting for local/external vendor
  transports.

## v0.5.0 - 2026-06-15

Source range: `v0.4.0..v0.5.0`.

### Changed

- Versioned all packages to `0.5.0`.
- No runtime source changes landed in this tag; it is a release/version
  alignment point after the `v0.4.0` release work.

## v0.4.0 - 2026-06-15

Source range: `v0.3.1..v0.4.0`.

### Added

- Added the VitePress documentation site, generated package/API reference pages,
  LLM documentation entry points, GitHub Pages deployment, and a Chinese docs
  locale.
- Added the LoggerJS agent skill package and docs.

### Changed

- Moved npm publishing to Trusted Publisher/OIDC with explicit preflight checks
  and updated release documentation.
- Refreshed README, logo, benchmark comparison wording, and generated docs.

### Tests

- Expanded reliability and payload edge coverage around the public surface.

## v0.3.1 - 2026-06-14

Source range: `v0.3.0..v0.3.1`.

### Added

- Added `@loggerjs/pretty` with browser console formatting, Node stream/stdout/
  stderr pretty transports, and local pretty-output demos.
- Added prepared record encoders for stable logger/tag fragments.
- Added benchmark matrix workflow/evidence, production recipes, governance,
  security policy, API stability docs, and generated test inventory.

### Changed

- Optimized the lean record path and `fastEventJsonCodec` hot path while
  tightening benchmark regression gates.
- Refreshed comparison, performance, migration, and README documentation.

### Fixed

- Hardened privacy guard email redaction.
- Preserved core record/error contracts across hostile inputs.
- Added browser IndexedDB offline-path performance coverage.

## v0.3.0 - 2026-06-13

Source range: `v0.2.0..v0.3.0`.

### Added

- Added explicit transport readiness semantics and documented transport
  reliability posture.
- Added `pinoCompatCodec()` / `pinoNdjsonProjector()` for common Pino-shaped
  NDJSON migration.
- Added shared Node destination handling, fatal crash flush tests, worker
  lifecycle protocol, logger diagnostics publishing, and service worker
  transport readiness.
- Added browser E2E coverage in Firefox/WebKit, non-Node runtime smoke tests,
  live integration harnesses, coverage/mutation/soak quality gates, and the
  production hardening implementation record.

### Changed

- Clarified redaction options and browser transport loss windows.
- Updated size budgets, API reports, and hardening docs to match the
  implementation.

### Fixed

- Gated diagnostics by subscribed stage.
- Closed transports without fallback flush when a transport owns `close()`.
- Kept worker listeners during close-time flush, exposed worker readiness, and
  handled destination stream errors.

## v0.2.0 - 2026-06-13

Source range: `@loggerjs/core@0.0.2..v0.2.0`. Package versions in this tag are
`0.1.0`.

### Added

- Added core reliability wrappers, logger self metrics, trace context propagation
  helpers, semantic event conventions, and payload transform helpers.
- Added browser offline-first transport, context propagation integration,
  framework router adapters, compression payload transform, and Chromium example
  E2E coverage.
- Added Node signal flushing, framework/data/job adapters, and compression
  payload transform support.
- Added processor coalescing and stack symbolication hooks.
- Added runtime compatibility and packed-consumer smoke checks.

### Changed

- Documented reliability and payload transform APIs and refreshed the README
  overview.
- Updated package size budgets and API reports for the expanded public surface.

### Fixed

- Delivered single logs correctly to batch transports.
- Replayed browser offline queues without requiring prior transport context.
- Retained HTTP batches when payload transforms fail.
- Isolated ambient context provider teardown.

## Package tags 0.0.2 - 2026-06-12

Source range: `v0.0.1..@loggerjs/core@0.0.2`. Package tags:
`@loggerjs/*@0.0.2`.

### Changed

- Republished all packages through the explicit provenance publishing path.
- Hardened release workflow token validation, package tag pushing, and
  provenance flags.

## v0.0.1 and package tags 0.0.1 - 2026-06-12

Source range: repository start through `v0.0.1`, followed by package tags
`@loggerjs/*@0.0.1`.

### Added

- Initial public LoggerJS monorepo and package set:
  `@loggerjs/core`, `@loggerjs/browser`, `@loggerjs/node`,
  `@loggerjs/processors`, `@loggerjs/codecs`, `@loggerjs/otel`,
  `@loggerjs/sentry`, `@loggerjs/datadog`, `@loggerjs/elastic`,
  `@loggerjs/loki`, `@loggerjs/cloudwatch`, and `@loggerjs/database`.
- Core structured logger pipeline with levels, typed events, ambient context,
  middleware, processors, codecs, meta counters, sync/async flush, batch/retry
  transports, test transport, and record-aware transport dispatch.
- Browser HTTP, IndexedDB/offline queue, WebSocket, BroadcastChannel, Service
  Worker, IndexedDB store/export, Web Vitals, Performance, Reporting, router,
  framework error, user action, runtime host, console, error, fetch, XHR, and
  lifecycle integrations.
- Node stdout/stderr/file/rotating-file/http/syslog/worker transports,
  AsyncLocalStorage context, process capture, diagnostics channel, HTTP/fetch,
  database, queue, CLI, serverless, Express, Fastify, Koa, Nest, Hapi, Prisma,
  Redis, and BullMQ integrations.
- Processor toolbox for rate limiting, fingers-crossed buffering, enrichment,
  level overrides, filtering/routing, fingerprinting, error normalization, stack
  parsing, privacy guarding, schema dev checks, dynamic sampling, breadcrumb
  buffering, redaction, sampling, dedupe, and coalescing.
- Fast JSON, safe JSON, NDJSON, metrics, msgpackr, projector, and Pino-compatible
  codecs.
- OTLP, OpenTelemetry log bridge/trace helpers, Sentry, Datadog, Elastic, Loki,
  CloudWatch, SQLite/Postgres/database transports.
- Package subpath exports, API reports, package validation, smoke tests,
  benchmarks, size budgets, release dry-run workflow, operations docs, examples,
  and migration guides.
