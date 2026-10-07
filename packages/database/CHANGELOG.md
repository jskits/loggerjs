# @loggerjs/database

## 0.7.0

### Minor Changes

- Version alignment for package release `0.7.0`: every `@loggerjs/*` package moves to 0.7.0 together.

### Patch Changes

- Depend on `@loggerjs/core` with a caret range instead of an exact version. Upgrading `@loggerjs/core` on its own no longer forces the package manager to install a second copy of core underneath each LoggerJS package.

- Declare `engines.node: ">=20.19.0"`, the oldest Node release the packed packages are smoke-tested on in CI. Package managers can now warn when LoggerJS is installed on an older Node.

- Smaller application bundles. `createLogger()` with `consoleTransport()` drops from about 6.3 KB to 5.5 KB gzip after tree-shaking and minification, `browserHttpTransport()` from 8.5 KB to 7.8 KB, and `stdoutTransport()` from 6.9 KB to 6.2 KB.

  - New `safeJsonEncoder()` and `ndjsonEncoder()` in `@loggerjs/core/codec-json` are `safeJsonCodec()` and `ndjsonCodec()` without `decode()`. Transports that only send logs (browser and Node HTTP, WebSocket, worker, database, Node stdout and file) default to them, and `consoleTransport({ pretty: false })` encodes the same way, so apps that never decode leave out the payload validation. Output is unchanged.
  - Diagnostics instrumentation is removed entirely from bundles that never install a diagnostics sink, instead of leaving inert checks behind.

- Updated dependencies:
  - @loggerjs/core@0.7.0

## 0.6.0

### Patch Changes

- The database transports pick up the `@loggerjs/core` `batchTransport()` fix: when the database is failing, `close()` now stops retrying, still releases the adapter, and counts undelivered rows as `transport.dropped.closed`. No database source changes are included in this release.
- Updated dependencies:
  - @loggerjs/core@0.6.0

## 0.5.6

### Patch Changes

- Version alignment for package release `0.5.6`.
- No database runtime source changes landed between the `0.5.5` and `0.5.6` package releases.
- Updated dependencies:
  - @loggerjs/core@0.5.6

## 0.5.5

### Patch Changes

- Version alignment for package release `0.5.5`.
- No database runtime source changes landed between the `0.5.4` and `0.5.5` package releases.
- Updated dependencies:
  - @loggerjs/core@0.5.5

## 0.5.4

### Patch Changes

- Version alignment for package release `0.5.4`.
- No database runtime source changes landed between the `0.5.3` and `0.5.4` package releases.
- Updated dependencies:
  - @loggerjs/core@0.5.4

## 0.5.3

### Patch Changes

- Split the database package into physical `transport`, `sqlite`, and `postgres` entry modules while keeping the root export compatible.
- Pointed `@loggerjs/database/transport`, `@loggerjs/database/sqlite`, and `@loggerjs/database/postgres` subpath exports at their dedicated bundles and declaration files.
- Added source-bound transport contract verification for the database transport matrix.
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

- Version alignment for repository tag `v0.3.0`; no database transport API changes.
- Updated dependency `@loggerjs/core` to the matching release.

## 0.1.0 - 2026-06-13 (repository tag `v0.2.0`)

- Version alignment for repository tag `v0.2.0`; no database transport API changes.
- Updated dependency `@loggerjs/core` to the matching release.

## 0.0.2 - 2026-06-12 (package tag `@loggerjs/database@0.0.2`)

- Republished through the explicit provenance publishing path.
- Updated dependency `@loggerjs/core` to the matching release.

## 0.0.1 - 2026-06-12 (package tag `@loggerjs/database@0.0.1`)

- Initial database transport package with generic, SQLite, and Postgres adapters.
- Updated dependency `@loggerjs/core` to the matching release.
