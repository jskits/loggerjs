# @loggerjs/core

## 0.5.2

- Version alignment for package release `0.5.2`.
- No package runtime source changes landed between the `0.5.1` and `0.5.2` package releases.

This changelog has been corrected against the git tag history. Untagged generated entries that were later reset are folded into the tagged release where their commits shipped.

## 0.5.1

- Kept the core public type surface and source typecheck compatible with TypeScript projects that do not include DOM libs.
- Added no-DOM platform type verification for the package source and exported API report.

## 0.5.0 - 2026-06-15 (repository tag `v0.5.0`)

- Version alignment for repository tag `v0.5.0`.
- No package runtime source changes landed between `v0.4.0` and `v0.5.0`.

## 0.4.0 - 2026-06-15 (repository tag `v0.4.0`)

- Version alignment for repository tag `v0.4.0`.
- Release focused on docs site, generated references, localization, agent skill docs, and npm Trusted Publisher/OIDC workflow hardening.

## 0.3.1 - 2026-06-14 (repository tag `v0.3.1`)

- Hardened record/error contracts and hostile input handling.
- Optimized the lean record path by avoiding unnecessary context/middleware allocations.
- Added prepared record encoders for stable logger/tag fragments.

## 0.3.0 - 2026-06-13 (repository tag `v0.3.0`)

- Added explicit transport readiness semantics.
- Gated diagnostics by subscribed stage and closed transports without fallback flush when `close()` owns the lifecycle.
- Updated transport lifecycle and reliability contracts.

## 0.1.0 - 2026-06-13 (repository tag `v0.2.0`)

- Added reliability wrappers, logger self metrics, trace context propagation helpers, semantic event conventions, and payload transform helpers.
- Fixed single-log delivery to batch transports and ambient context provider teardown.

## 0.0.2 - 2026-06-12 (package tag `@loggerjs/core@0.0.2`)

- Republished through the explicit provenance publishing path.

## 0.0.1 - 2026-06-12 (package tag `@loggerjs/core@0.0.1`)

- Initial core package with logger creation, levels, records/events, middleware, processors, codecs, transport contracts, registry configuration, meta counters, sync/async flush, console/memory/batch/test transports, and record-aware dispatch.
