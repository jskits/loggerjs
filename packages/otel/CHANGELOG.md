# @loggerjs/otel

## 1.0.0

### Major Changes

- `@loggerjs/core` is now a peer dependency of every other package, so an application installs exactly one copy of core. Install it alongside the packages you use, for example `npm install @loggerjs/core @loggerjs/node`; npm and pnpm add a missing peer automatically, Yarn does not. Every package requires `@loggerjs/core` `^1.0.0`.

- Require Node 22 or later: every package declares `engines.node: ">=22.0.0"`, and CI smoke-tests the packed packages on Node 22.0.0, the latest Node 22, and Node 24. Node 20 is no longer supported. Each Node line a major ships with stays supported for that whole major (see GOVERNANCE).

- LoggerJS 1.0. Every `@loggerjs/*` package moves to 1.0.0. Semantic versioning covers Stable exports: no removals, renames, or signature breaks within a major. Compatible exports and Experimental packages change only after a deprecation in an earlier minor. The support windows in GOVERNANCE and SECURITY now apply to every package: the previous minor gets security and data-loss fixes for six months after the next minor ships, the last 0.x minor gets security fixes for three months, and every Node line and browser baseline a major ships with stays supported for that whole major.

### Patch Changes

- Updated dependencies:
  - @loggerjs/core@1.0.0

## 0.7.0

### Minor Changes

- Version alignment for package release `0.7.0`: every `@loggerjs/*` package moves to 0.7.0 together.

### Patch Changes

- Depend on `@loggerjs/core` with a caret range instead of an exact version. Upgrading `@loggerjs/core` on its own no longer forces the package manager to install a second copy of core underneath each LoggerJS package.

- Declare `engines.node: ">=20.19.0"`, the oldest Node release the packed packages are smoke-tested on in CI. Package managers can now warn when LoggerJS is installed on an older Node.

- Honor `Retry-After`. HTTP transports now throw `httpStatusError()` for non-2xx responses, which carries `status` and, when the response sends `Retry-After` (delay-seconds or an HTTP-date), `retryAfterMs`. `batchTransport()` and `retryTransport()` wait at least that long before the next attempt. A wait longer than `retryMaxDelayMs` ends the current retries instead: `batchTransport()` puts the batch back and sends nothing until the wait ends (counted as `transport.retry.deferred`), and `retryTransport()` gives up with reason `retry-exhausted`, so `flush()` and `close()` are never held by a long server-requested wait. `browserHttpTransport()` pauses scheduled, full-batch, and explicit sends and offline replay until the wait ends; cross-origin collectors must expose `Retry-After` through `Access-Control-Expose-Headers`.

  `parseRetryAfter()` and `httpStatusError()` are exported from `@loggerjs/core` for custom HTTP transports. Error messages are unchanged.

- Updated dependencies:
  - @loggerjs/core@0.7.0

## 0.6.0

### Patch Changes

- `otlpHttpTransport()` picks up the `@loggerjs/core` `batchTransport()` fix: when the collector is failing, `close()` now stops retrying, closes cleanly, and counts undelivered records as `transport.dropped.closed`. No OpenTelemetry source changes are included in this release.
- Updated dependencies:
  - @loggerjs/core@0.6.0

## 0.5.6

### Patch Changes

- Version alignment for package release `0.5.6`.
- No OTEL runtime source changes landed between the `0.5.5` and `0.5.6` package releases.
- Updated dependencies:
  - @loggerjs/core@0.5.6

## 0.5.5

### Patch Changes

- Version alignment for package release `0.5.5`.
- No OTEL runtime source changes landed between the `0.5.4` and `0.5.5` package releases.
- Updated dependencies:
  - @loggerjs/core@0.5.5

## 0.5.4

### Patch Changes

- Hardened OTLP HTTP transport coverage for default content type, custom headers, `minLevel` filtering, missing `fetch`, rejected `fetch`, and non-2xx collector responses.
- Raised the OTLP package coverage floor after the transport failure-path tests.
- No OTEL runtime source changes landed between the `0.5.3` and `0.5.4` package releases.
- Updated dependencies:
  - @loggerjs/core@0.5.4

## 0.5.3

### Patch Changes

- Pointed OTLP HTTP transport, OTLP JSON codec, trace, and log-bridge subpath exports at physical bundles and declaration files.
- Pinned OTLP JSON wire mapping for resource attributes, scope grouping, supported AnyValue shapes, trace flag fallback, and empty-category scope fallback.
- No OTEL runtime API changes landed in this release.
- Updated dependencies:
  - @loggerjs/core@0.5.3

## 0.5.2

- Version alignment for package release `0.5.2`.
- No package runtime source changes landed between the `0.5.1` and `0.5.2` package releases.
- Updated dependency `@loggerjs/core` to the matching release.

This changelog has been corrected against the git tag history. Untagged generated entries that were later reset are folded into the tagged release where their commits shipped.

## 0.5.1

- Version alignment for package release `0.5.1`.
- No package runtime source changes landed between the `0.5.0` and `0.5.1` package releases.
- Updated dependency `@loggerjs/core` to the matching release.

## 0.5.0 - 2026-06-15 (repository tag `v0.5.0`)

- Version alignment for repository tag `v0.5.0`.
- No package runtime source changes landed between `v0.4.0` and `v0.5.0`.

## 0.4.0 - 2026-06-15 (repository tag `v0.4.0`)

- Version alignment for repository tag `v0.4.0`.
- Release focused on docs site, generated references, localization, agent skill docs, and npm Trusted Publisher/OIDC workflow hardening.

## 0.3.1 - 2026-06-14 (repository tag `v0.3.1`)

- Version alignment for repository tag `v0.3.1`.
- Updated dependency `@loggerjs/core` to the matching release.

## 0.3.0 - 2026-06-13 (repository tag `v0.3.0`)

- Version alignment for repository tag `v0.3.0`; no OTLP/log bridge API changes.
- Updated dependency `@loggerjs/core` to the matching release.

## 0.1.0 - 2026-06-13 (repository tag `v0.2.0`)

- Version alignment for repository tag `v0.2.0`; no OTLP/log bridge API changes.
- Updated dependency `@loggerjs/core` to the matching release.

## 0.0.2 - 2026-06-12 (package tag `@loggerjs/otel@0.0.2`)

- Republished through the explicit provenance publishing path.
- Updated dependency `@loggerjs/core` to the matching release.

## 0.0.1 - 2026-06-12 (package tag `@loggerjs/otel@0.0.1`)

- Initial OpenTelemetry package with OTLP/HTTP JSON transport, OTLP codec, active span trace processor, and log bridge transport.
- Updated dependency `@loggerjs/core` to the matching release.
