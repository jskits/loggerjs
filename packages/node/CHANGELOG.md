# @loggerjs/node

This changelog has been corrected against the git tag history. Untagged generated entries that were later reset are folded into the tagged release where their commits shipped.

## Unreleased (`v0.5.0..HEAD`)

- Split public transport/integration subpath exports into physical entry bundles so narrow imports do not point at the aggregate bundle.
- Clarified Node runtime compatibility docs: repo development uses Node >=22.13, published package smoke starts at Node 20.19.0.


## 0.5.0 - 2026-06-15 (repository tag `v0.5.0`)

- Version alignment for repository tag `v0.5.0`.
- No package runtime source changes landed between `v0.4.0` and `v0.5.0`.


## 0.4.0 - 2026-06-15 (repository tag `v0.4.0`)

- Version alignment for repository tag `v0.4.0`.
- Release focused on docs site, generated references, localization, agent skill docs, and npm Trusted Publisher/OIDC workflow hardening.


## 0.3.1 - 2026-06-14 (repository tag `v0.3.1`)

- Version alignment for repository tag `v0.3.1`; process integration tests were expanded.
- Updated dependency `@loggerjs/core` to the matching release.


## 0.3.0 - 2026-06-13 (repository tag `v0.3.0`)

- Added shared destination write handling, fatal crash flush coverage, worker lifecycle protocol, worker readiness, logger diagnostics publishing, and stream error handling.
- Fixed close-time worker listener handling and transport close fallback behavior through core dependency updates.
- Updated dependency `@loggerjs/core` to the matching release.


## 0.1.0 - 2026-06-13 (repository tag `v0.2.0`)

- Added process signal flushing, Koa/Nest/Hapi adapters, Prisma/Redis/data/job adapters, and Node compression payload transform support.
- Added packed-consumer and supported Node runtime smoke coverage.
- Updated dependency `@loggerjs/core` to the matching release.


## 0.0.2 - 2026-06-12 (package tag `@loggerjs/node@0.0.2`)

- Republished through the explicit provenance publishing path.
- Updated dependency `@loggerjs/core` to the matching release.


## 0.0.1 - 2026-06-12 (package tag `@loggerjs/node@0.0.1`)

- Initial Node package with stdout/stderr/file/rotating-file/http/syslog/worker transports, AsyncLocalStorage context, process capture, diagnostics channel, HTTP/fetch/database/queue/CLI/serverless/framework integrations, and worker offload support.
- Updated dependency `@loggerjs/core` to the matching release.
