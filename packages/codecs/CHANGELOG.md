# @loggerjs/codecs

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
- Updated dependencies:
  - @loggerjs/core@0.7.0

## 0.6.0

### Patch Changes

- `fastEventJsonCodec()`, `pinoCompatCodec()`, and other string codecs can now be passed directly to transports such as `nodeHttpTransport()` and `stdoutTransport()` under strict TypeScript, thanks to the `Codec` type fix in `@loggerjs/core` 0.6.0. No codec source changes are included in this release.
- Updated dependencies:
  - @loggerjs/core@0.6.0

## 0.5.6

### Patch Changes

- Version alignment for package release `0.5.6`.
- No codecs runtime source changes landed between the `0.5.5` and `0.5.6` package releases.
- Updated dependencies:
  - @loggerjs/core@0.5.6

## 0.5.5

### Patch Changes

- Version alignment for package release `0.5.5`.
- No codecs runtime source changes landed between the `0.5.4` and `0.5.5` package releases.
- Updated dependencies:
  - @loggerjs/core@0.5.5

## 0.5.4

### Patch Changes

- Version alignment for package release `0.5.4`.
- No codecs runtime source changes landed between the `0.5.3` and `0.5.4` package releases.
- Updated dependencies:
  - @loggerjs/core@0.5.4

## 0.5.3

### Patch Changes

- `fastEventJsonCodec().decode()` now validates decoded log-event payloads before returning typed values, rejecting malformed objects, invalid levels, non-finite numbers, invalid tags, and invalid serialized errors.
- Expanded codec tests for validation branches, array payloads, fast-path fallback behavior, and Pino-compatible projection edge cases.
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

- Optimized `fastEventJsonCodec` for lean record/event output and covered quality-gate codec branches.
- Kept output compatibility while tightening benchmark regression gates.
- Updated dependency `@loggerjs/core` to the matching release.

## 0.3.0 - 2026-06-13 (repository tag `v0.3.0`)

- Added `pinoCompatCodec()` and `pinoNdjsonProjector()` for common Pino-shaped NDJSON migration.
- Updated dependency `@loggerjs/core` to the matching release.

## 0.1.0 - 2026-06-13 (repository tag `v0.2.0`)

- Version alignment for repository tag `v0.2.0`; no codecs API changes.
- Updated dependency `@loggerjs/core` to the matching release.

## 0.0.2 - 2026-06-12 (package tag `@loggerjs/codecs@0.0.2`)

- Republished through the explicit provenance publishing path.
- Updated dependency `@loggerjs/core` to the matching release.

## 0.0.1 - 2026-06-12 (package tag `@loggerjs/codecs@0.0.1`)

- Initial codecs package with fast event JSON, msgpackr, projector, and Pino-compatible serialization helpers.
- Updated dependency `@loggerjs/core` to the matching release.
