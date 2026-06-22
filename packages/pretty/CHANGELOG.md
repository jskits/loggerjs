# @loggerjs/pretty

## 0.5.4

### Patch Changes

- Expanded formatter, pretty console, and stream transport coverage for output suppression, time formatting, truncation, console fallback, batch entry points, write failures, stream errors, flush rejection, and close lifecycle behavior.
- Raised the Pretty package coverage floor after the formatter and transport edge-case tests.
- No Pretty runtime source changes landed between the `0.5.3` and `0.5.4` package releases.
- Updated dependencies:
  - @loggerjs/core@0.5.4

## 0.5.3

### Patch Changes

- Pointed `formatter`, `transport-console`, and `transport-stream` subpath exports at physical bundles and declaration files.
- No pretty formatter or transport runtime source changes landed in this release.
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

- Initial pretty output package with `formatPrettyEvent`, `prettyConsoleTransport`, `prettyStreamTransport`, `prettyStdoutTransport`, and `prettyStderrTransport`.
- Added browser and terminal pretty-output demos.
- Updated dependency `@loggerjs/core` to the matching release.
