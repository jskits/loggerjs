# Governance

LoggerJS is currently maintained by the project owner with CODEOWNERS review
boundaries. The goal before 1.0 is to make compatibility, security, and release
decisions explicit enough for additional maintainers to participate safely.

## Roles

- **Maintainer**: can merge changes, cut releases, update API stability policy,
  and handle security advisories.
- **Contributor**: proposes patches, tests, docs, benchmark evidence, or issue
  reproductions.
- **Security reporter**: coordinates vulnerability details through
  `SECURITY.md`.

## Decision Rules

- Public API changes must update `docs/API-STABILITY.md` when they affect the
  stable or experimental surface.
- Performance claims must cite `docs/BENCHMARKS.md` or
  `docs/BENCHMARK-MATRIX.md`; broader claims require matching benchmark rows.
- Security and privacy changes require tests for the failing input or threat
  class.
- Runtime-specific changes should stay in the matching package rather than
  adding platform dependencies to `@loggerjs/core`.

## Releases

Releases are versioned through Changesets and published by the maintainer. While
LoggerJS is pre-1.0, breaking changes may still happen, but each release should
document migration impact in package changelogs or release notes.

## Adding Maintainers

A new maintainer should have a visible history of scoped reviews or patches in
at least two of these areas:

- core API and type stability,
- browser or Node runtime integrations,
- transports and delivery reliability,
- codecs and performance benchmarks,
- security/privacy processing.

Maintainer changes should be reflected in `CODEOWNERS` and this file.
