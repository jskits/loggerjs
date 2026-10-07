# Governance

LoggerJS is currently maintained by the project owner with CODEOWNERS review boundaries. The goal before 1.0 is to make compatibility, security, and release decisions explicit enough for additional maintainers to participate safely.

## Roles

- **Maintainer**: can merge changes, cut releases, update API stability policy, and handle security advisories.
- **Contributor**: proposes patches, tests, docs, benchmark evidence, or issue reproductions.
- **Security reporter**: coordinates vulnerability details through `SECURITY.md`.

## Decision Rules

- Public API changes must update `docs/API-STABILITY.md` when they affect the stable or experimental surface.
- New public transport or integration subpaths must update the stability table, import-boundary list, runtime validation guidance, and package size impact in the same change. `pnpm verify:component-docs` enforces the import-boundary documentation requirement.
- Performance claims must cite `docs/BENCHMARKS.md` or `docs/BENCHMARK-MATRIX.md`; broader claims require matching benchmark rows.
- Security and privacy changes require tests for the failing input or threat class.
- Runtime-specific changes should stay in the matching package rather than adding platform dependencies to `@loggerjs/core`.

## Current Expansion Policy

LoggerJS is in a stabilization phase before v1. Prefer hardening existing transports, integrations, processors, docs, benchmarks, and runtime validation over adding more built-in components. A new built-in component should clear all of these gates before merge:

- it addresses a production use case not already covered by composition;
- it stays in a runtime-appropriate package or a separate adapter package;
- it has unit tests plus the nearest real-environment or live-service validation practical for that runtime;
- it has explicit stability, reliability, privacy, and import-boundary docs;
- it does not grow root aggregate package budgets without justification.

## Releases

Releases are versioned through Changesets and published by the maintainer. While LoggerJS is pre-1.0, breaking changes may still happen, but each release should document migration impact in package changelogs or release notes.

## Adding Maintainers

A new maintainer should have a visible history of scoped reviews or patches in at least two of these areas:

- core API and type stability,
- browser or Node runtime integrations,
- transports and delivery reliability,
- codecs and performance benchmarks,
- security/privacy processing.

Maintainer changes should be reflected in `CODEOWNERS` and this file.

## v1 Readiness

A 1.0.0 release is a maintenance promise, not a feature milestone. Before tagging it, the maintainer should be able to check every item below. The support commitments after the checklist are adopted, and `SECURITY.md` states the same windows.

- **Real usage.** At least three design-partner projects, covering a browser app, a Node service, and an Electron app, have run the stable kernel in production for eight weeks or more and shared `transport.dropped.*`, `transport.retry.*`, and queue-depth metrics. API that none of them used is moved out of the stable set or removed before the freeze.
- **Second maintainer.** At least one more maintainer with review history (see Adding Maintainers) and npm publish access, so releases and security fixes do not depend on one person.
- **Failure evidence.** The failure-injection suites, the lifecycle model tests, the browser upgrade tests, and a 60-minute run of the `Soak` workflow pass on the release commit, and the Windows CI job is green.
- **Node support.** `engines.node` and the lowest `ci.yml` node-compat version name a Node line that is still maintained upstream at release time.

Support commitments after 1.0.0:

- **Release lines.** The latest 1.x minor receives all fixes. The previous minor receives security and data-loss fixes for six months after the next minor ships.
- **0.x.** When 1.0.0 ships, the last 0.x minor receives security fixes for three months. Earlier 0.x minors receive none.
- **Node.** 1.0 requires Node 22 or later. Every Node line a major supports when it ships stays supported, with CI coverage, for that whole major, even after the line reaches end of life. Only a new major drops Node lines, and it drops the ones that reached end of life. Keeping an old Node line in CI is cheaper than a yearly major.
- **Browsers.** The baseline is Chrome and Edge 103, Firefox 100, and Safari 16, the first versions with `AbortSignal.timeout()`, which the HTTP transport timeouts use. Raising the baseline is a major release, like dropping a Node line.
- **Security response.** Acknowledgement within 7 days and triage within 14 days, as stated in `SECURITY.md`. A one-maintainer project cannot promise more until a second maintainer is in place.
