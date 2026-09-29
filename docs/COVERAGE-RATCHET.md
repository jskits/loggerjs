# Coverage Ratchet

Coverage thresholds are regression floors, not quality goals. Raise them only after a measured run shows enough margin for normal V8 coverage noise and after the added tests exercise meaningful behavior rather than implementation trivia.

The thresholds live in `vitest.coverage.config.ts`. Regenerate the snapshot with:

```bash
pnpm test:coverage
```

## Current Snapshot

Measured on 2026-09-29 with `pnpm test:coverage`.

| Scope | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| All files | 87.26 | 78.57 | 90.99 | 91.27 |
| Browser package | 84.51 | 73.87 | 87.14 | 89.28 |
| Browser HTTP transport | 96.90 | 93.83 | 95.45 | 99.55 |
| Core package | 87.42 | 80.10 | 90.34 | 90.68 |
| OTLP package | 95.79 | 85.06 | 100.00 | 98.68 |
| Pretty package | 90.64 | 84.91 | 90.00 | 94.02 |

## Weak Spots

| Area | Measured gap | Next action |
| --- | --- | --- |
| OTLP package | Package coverage meets the transport failure-path contract, but `log-bridge.ts` (74% branches) and `trace.ts` (78% branches) still carry untested fallback branches. | Keep the package floor and add targeted tests when those branches change. |
| Pretty package | Package coverage is close to the repository average. `console-transport.ts` branch coverage (67%) is the lowest file in the package. | Keep package floors near measured coverage; do not raise file floors until console auto-style branches are covered. |
| Browser package | `indexeddb-transport.ts` (64% branches) pulls the package average down. | Keep package floors conservative, keep the file-level floor for `http-transport.ts`, and improve IndexedDB edge coverage incrementally. |

## Ratchet Rules

- Keep global thresholds at least two percentage points below the measured total unless the gap is intentionally narrow and documented here.
- Prefer file-level thresholds for high-risk files that already have mature coverage, such as browser HTTP delivery and OTLP JSON mapping.
- Do not raise a package threshold because another file compensates for an uncovered risky branch.
- Coverage-only tests must still assert externally observable behavior: errors, retries, filtering, import boundaries, exported file names, lifecycle cleanup, or captured payload shape.
- Lowering a threshold requires an explicit quality review in the same change.

## Current Floors

| Scope | Floor (statements / branches / functions / lines) | Notes |
| --- | --- | --- |
| Global | 86 / 76 / 90 / 90 | The next branch increase should come from browser or Node edge tests, not from Pretty compensation. |
| OTLP | 94 / 80 / 100 / 98 | Set after the transport failure-path tests. |
| Pretty | 88 / 82 / 88 / 92 | Set after the formatter, console fallback, and stream lifecycle tests. |
| Browser | 84 / 73 / 86 / 89 | `http-transport.ts` also has a file floor of 95 / 91 / 92 / 99. |
