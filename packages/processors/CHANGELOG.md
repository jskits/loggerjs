# @loggerjs/processors

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

- Import core helpers that leave the `@loggerjs/core` root in 1.0 (payload transforms, trace propagation, diagnostics, integration helpers, and event routes) from their `@loggerjs/core/*` subpaths. These packages now need `@loggerjs/core` 0.7 or later, which their dependency range already requires.
- Updated dependencies:
  - @loggerjs/core@0.7.0

## 0.6.0

### Minor Changes

- `redactProcessor()` no longer destroys values that serialize through `toJSON()`. It rebuilt every object from its own enumerable properties, so a `URL` in log data became `{}` and custom `toJSON()` output was replaced by raw fields. Such values are now redacted in the form they serialize to, so a `URL` stays its string (`Date` values are still kept as-is). If `toJSON()` throws, the value is replaced so the event never passes through unredacted.

### Patch Changes

- `privacyGuardProcessor()` now scans values that serialize through `toJSON()`. It only walked own enumerable properties, so a `URL` (which has none) was passed through unscanned and an email or token in its query string reached the transport; custom `toJSON()` output was not scanned either. The serialized form is now guarded, the original object is kept when nothing needs redaction, and a throwing `toJSON()` is replaced.
- Updated dependencies:
  - @loggerjs/core@0.6.0

## 0.5.6

### Patch Changes

- Version alignment for package release `0.5.6`.
- No processors runtime source changes landed between the `0.5.5` and `0.5.6` package releases.
- Updated dependencies:
  - @loggerjs/core@0.5.6

## 0.5.5

### Patch Changes

- Version alignment for package release `0.5.5`.
- No processors runtime source changes landed between the `0.5.4` and `0.5.5` package releases.
- Updated dependencies:
  - @loggerjs/core@0.5.5

## 0.5.4

### Patch Changes

- Version alignment for package release `0.5.4`.
- No processors runtime source changes landed between the `0.5.3` and `0.5.4` package releases.
- Updated dependencies:
  - @loggerjs/core@0.5.4

## 0.5.3

### Patch Changes

- `redactProcessor()` and `privacyGuardProcessor()` now support symbol matchers and traverse own enumerable symbol keys on plain objects, errors, and symbol-keyed map entries.
- Expanded `normalizeErrorProcessor()` edge coverage for primitive thrown values, circular causes, aggregate-error options, stack/code handling, and enumerable extras.
- Added per-file privacy mutation thresholds for `redact`, `privacy-guard`, and `normalize-error`.
- Updated dependencies:
  - @loggerjs/core@0.5.3

## 0.5.2

- Fixed `redactProcessor` to fail closed past `maxDepth`, replacing too-deep subtrees with the configured replacement instead of passing plaintext values through.
- Hardened `redactProcessor` and `privacyGuardProcessor` for native `Error` values: own enumerable properties are now traversed, native `cause` and `AggregateError.errors` are preserved and recursively redacted or guarded, and `privacyGuardProcessor` scans raw `Error.message`/`Error.stack` text.
- Preserved `Map` and `Set` values while recursively redacting or guarding their contents instead of dropping them during traversal.
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

- Hardened privacy guard email redaction.
- Version alignment with core hot-path and prepared encoder improvements.
- Updated dependency `@loggerjs/core` to the matching release.

## 0.3.0 - 2026-06-13 (repository tag `v0.3.0`)

- Clarified redaction options and kept redaction behavior covered in the production hardening release.
- Updated dependency `@loggerjs/core` to the matching release.

## 0.1.0 - 2026-06-13 (repository tag `v0.2.0`)

- Added coalescing and stack symbolication processors.
- Updated dependency `@loggerjs/core` to the matching release.

## 0.0.2 - 2026-06-12 (package tag `@loggerjs/processors@0.0.2`)

- Republished through the explicit provenance publishing path.
- Updated dependency `@loggerjs/core` to the matching release.

## 0.0.1 - 2026-06-12 (package tag `@loggerjs/processors@0.0.1`)

- Initial processor toolbox with middleware aliases, rate limiting, fingers-crossed buffering, enrichment, level overrides, filtering/routing, fingerprinting, error normalization, stack parsing, privacy guarding, schema dev checks, dynamic sampling, breadcrumb buffering, redaction, sampling, dedupe, and coalescing.
- Updated dependency `@loggerjs/core` to the matching release.
