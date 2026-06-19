# @loggerjs/processors

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
