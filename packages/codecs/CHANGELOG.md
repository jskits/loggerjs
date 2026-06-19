# @loggerjs/codecs

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
