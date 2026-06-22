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
| All files | 86.47 | 77.65 | 90.27 | 90.76 |
| Browser package | 83.77 | 72.91 | 86.49 | 88.74 |
| Core package | 86.67 | 77.65 | 90.27 | 89.26 |
| OTLP package | 94.73 | 81.60 | 100.00 | 98.68 |
| Pretty package | 73.61 | 68.39 | 75.00 | 82.60 |

## Current Weak Spots

| Area | Measured gap | Next action |
| --- | --- | --- |
| OTLP transport | Package threshold is below measured reality. `transport.ts` branch coverage is 70.00 while the package is 81.60. | Add transport failure-path tests and raise the package floor. |
| Pretty output | Package branch/function coverage is materially lower than the rest of the repo. `stream-transport.ts` is the lowest file. | Cover formatter edge options, console fallbacks, and stream error/drain/close behavior before raising floors. |
| Browser package | Browser has broad runtime surface, and `indexeddb-transport.ts` pulls package averages down. | Keep package floors conservative, add file-level floors for well-covered high-risk files, and improve browser API absence/fallback branches incrementally. |

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
| Global | Move toward 86 / 78 / 90 / 90 while keeping branch growth tied to meaningful tests. |
| OTLP | Raise from 66 / 94 / 88 / 81 to a floor near the current measured package coverage after failure-path tests land. |
| Pretty | Raise only after `formatter`, `console-transport`, and `stream-transport` edge tests improve the measured floor. |
| Browser | Add file-level thresholds for `http-transport.ts` and keep package-level branch increases modest until IndexedDB edge coverage improves. |
