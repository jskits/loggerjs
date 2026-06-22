# Coverage Ratchet

Coverage thresholds are regression floors, not quality goals. Raise them only
after a measured run shows enough margin for normal V8 coverage noise and after
the added tests exercise meaningful behavior rather than implementation trivia.

Regenerate the snapshot with:

```bash
pnpm test:coverage
```

## Current Snapshot

Measured on 2026-06-22 with `pnpm test:coverage`.

| Scope | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| All files | 87.18 | 78.47 | 90.91 | 91.23 |
| Browser package | 84.25 | 73.49 | 86.86 | 89.12 |
| Browser HTTP transport | 95.90 | 91.09 | 92.50 | 99.46 |
| Core package | 86.67 | 77.65 | 90.27 | 89.26 |
| OTLP package | 95.78 | 85.05 | 100.00 | 98.68 |
| Pretty package | 90.63 | 84.90 | 90.00 | 94.02 |

## Current Weak Spots

| Area | Measured gap | Next action |
| --- | --- | --- |
| OTLP transport | Package coverage now matches the transport failure-path contract, but `log-bridge.ts` and `trace.ts` still carry untested fallback branches. | Keep the raised package floor and add targeted tests when those branches change. |
| Pretty output | Package coverage is now close to the repo average after formatter, console fallback, and stream lifecycle tests. `console-transport.ts` branch coverage remains the next local floor. | Keep package floors near current measured coverage; avoid raising file floors until console auto-style branches are covered. |
| Browser package | Browser API absence/fallback tests now cover BroadcastChannel, WebSocket, and ReportingObserver edges. `indexeddb-transport.ts` still pulls package averages down. | Keep package floors conservative, keep a file-level floor for `http-transport.ts`, and improve IndexedDB edge coverage incrementally. |

## Ratchet Rules

- Keep global thresholds at least two percentage points below the measured
  total unless the gap is intentionally narrow and documented here.
- Prefer file-level thresholds for high-risk files that already have mature
  coverage, such as browser HTTP delivery and OTLP JSON mapping.
- Do not raise a package threshold because another file compensates for an
  uncovered risky branch.
- Coverage-only tests must still assert externally observable behavior: errors,
  retries, filtering, import boundaries, exported file names, lifecycle cleanup,
  or captured payload shape.
- Lowering a threshold requires an explicit quality review in the same change.

## Near-Term Targets

| Scope | Target |
| --- | --- |
| Global | Current floor is statements 86, branches 76, functions 90, lines 90. The next branch increase should come from browser or node edge tests, not Pretty compensation. |
| OTLP | Current floor is statements 94, branches 80, functions 100, lines 98 after transport failure-path tests. |
| Pretty | Current floor is statements 88, branches 82, functions 88, lines 92 after formatter, console fallback, and stream lifecycle tests. |
| Browser | Current package floor is statements 84, branches 73, functions 86, lines 89. `http-transport.ts` also has a file floor of statements 95, branches 91, functions 92, lines 99. |
