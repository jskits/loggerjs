# Production Hardening - Lessons from Pino

**Status:** Implementation record and remaining roadmap
**Date:** 2026-06-13
**Scope:** `@loggerjs/core`, `@loggerjs/node`, `@loggerjs/browser`,
`@loggerjs/codecs`, vendor transports, and docs

This document is no longer a pre-implementation proposal. It records the Pino
lessons that were accepted, the hardening work that has landed, and the smaller
set of work that still remains. The authoritative API surface lives in the
package TypeScript declarations and `api-reports/`; operational user-facing
behavior is documented in `docs/CONCEPTS.md`, `docs/TRANSPORTS.md`,
`docs/OPERATIONS.md`, and package READMEs.

## 1. Thesis

LoggerJS should **not** adopt Pino's "assemble the NDJSON line in core directly
from call arguments" model. That trade is already decided in
`docs/ARCHITECTURE.md` and `README.md`: LoggerJS allocates one `LogRecord` per
log so middleware, integrations, routing, and multiple transports can observe a
single structured event. Serialization remains transport-owned through codecs.

The useful lesson from Pino is its production engineering discipline:
predictable destination lifecycles, explicit flush and exit semantics, worker
failure boundaries, honest reliability docs, and low-friction migration paths.
LoggerJS should keep its isomorphic structured pipeline, but make the operational
contract as explicit as a production Node logger.

## 2. Accepted Boundaries

- Keep provider-, format-, and platform-specific behavior in transport, codec,
  processor, or integration packages. Core defines contracts.
- Keep the hot path allocation model. The shared `LogRecord` pipeline remains
  the default; codec/transport-owned prepared encoders are acceptable because
  they reuse stable fragments without making core own serialization.
- Do not wait in normal `logger.info()` calls for transport startup. Readiness is
  explicit through `logger.ready()` / `transport.ready()`.
- Treat browser delivery as best effort unless the target destination has
  acknowledged the payload.
- Prefer type-safe, tree-shakeable, object-passing worker APIs over Pino-style
  runtime string module resolution.
- Keep redaction interpreter-based in core packages. Do not compile user paths
  with `eval` or `new Function`.

## 3. Current Implementation Snapshot

| Area | Current LoggerJS state | Remaining concern |
| --- | --- | --- |
| Transport lifecycle | `Transport` includes `ready`, `flush`, `flushSync`, and `close`; `Logger.ready()` is opt-in; core calls `close()` when present and falls back to `flush()` only for transports without `close()`. | Keep new transports aligned with the contract in `docs/CONCEPTS.md` and `docs/TRANSPORTS.md`. |
| Reliability posture | `docs/TRANSPORTS.md` now classifies immediate, batched, retried, durable queue, page-exit, worker, vendor, and database paths. | Keep examples honest when new vendor transports are added. Raw vendor wire transports should stay composable but must show production wrappers. |
| Pino migration | `@loggerjs/codecs` includes `pinoCompatCodec()` / `pinoNdjsonProjector()` with common-field tests against Pino; fast LoggerJS output stays in `fastEventJsonCodec`. | Compatibility is intentionally scoped to common NDJSON shape, not every Pino serializer/formatter edge case. |
| Binary codec | `msgpackrCodec()` is backed by a real `msgpackr` dependency while still allowing custom pack/unpack injection. | Keep dependency and bundle-size impact visible in size reports. |
| Browser loss windows | Browser HTTP, offline queue, IndexedDB, WebSocket, Service Worker, and BroadcastChannel loss windows are documented. `browserServiceWorkerTransport()` exposes `ready()` when `target: "ready"` is used. | Browser behavior still needs periodic real-browser validation because quota, Storage Buckets, beacon, and lifecycle behavior differ by browser/version. |
| IndexedDB throughput | `indexedDbTransport()` supports relaxed durability hints, optional Storage Buckets, TTL/count/byte pruning, stats, and explicit fallback to regular IndexedDB when buckets are unavailable. | Throughput depends on browser support and storage policy. Use benchmarks and feature detection before claiming broad browser parity. |
| Node destinations | `stdoutTransport`, `stderrTransport`, `fileTransport`, and `rotatingFileTransport` share the internal Node destination path where applicable. It tracks callbacks/drain, optional `minLength`, stream errors, `EPIPE`, sync file mode, and crash-path `flushSync`. | `flushSync()` in async file mode is a crash-path primitive; if the process continues, the original async stream may still complete. Docs already call this out. |
| Fatal crash contract | `captureProcessIntegration({ exitOnUncaught })` captures a fatal record, calls `flushSync()`, waits for bounded async `flush()`, then exits. `docs/OPERATIONS.md` and tests cover the sequence, including a child-process fixture. | Remote HTTP/vendor transports must not be the only fatal-path sink. |
| Worker lifecycle | `workerTransport()` supports optional ready timeout, batch ack timeout, fallback/drop handling, pending-batch gauges, diagnostics, message listeners, close-time flush before listener removal, and `ready()`. | The worker API remains object-passing. Pino-style `target` / `targets` module hosting is deferred unless users need it more than type safety. |
| Diagnostics | `installLoggerDiagnosticsChannel()` publishes LoggerJS internal stages to `diagnostics_channel`. Stage-specific `hasSubscribers` gating avoids work for unsubscribed stages. | Transport-wide metric names are not yet fully uniform across every package. |
| Redaction | `redactProcessor()` documents exact keys, paths, `censor` alias, `remove`, depth limits, and no code generation. `privacyGuardProcessor()` remains the broad PII safety net. | Avoid broad regex/deep traversal on hot loggers unless measured. |

## 4. What Changed from the Original Proposal

### Implemented

1. **Lifecycle contract:** `ready()` is part of the public transport shape, and
   core exposes `logger.ready()` without blocking normal logging.
2. **Close semantics:** core no longer calls `flush()` after a transport-specific
   `close()` returns `void`; transports that own resources own their own
   flush-before-release behavior.
3. **Reliability docs:** transport posture and browser loss windows are explicit.
4. **Pino compatibility codec:** migration users can opt into Pino-shaped NDJSON
   without changing the default LoggerJS envelope.
5. **Redaction clarity:** Pino-friendly `censor` naming is accepted as an alias,
   while LoggerJS keeps safe interpreter-based matching.
6. **Shared Node destination:** stream/file transports share backpressure,
   buffering, stream error, EPIPE, close, and crash-flush behavior.
7. **Fatal-path tests and docs:** process crash behavior is documented and tested.
8. **Worker lifecycle:** ready/ack protocol, fallback/drop behavior, and close-time
   flush are implemented.
9. **Internal diagnostics:** LoggerJS emits optional diagnostic stages through a
   gated sink and Node `diagnostics_channel` bridge.

### Partially Implemented

1. **Consistent transport metrics:** queue depth, worker readiness, worker drops,
   batch drops, and many browser counters exist, but not every transport uses a
   single documented naming matrix yet.
2. **Runtime compatibility gate:** the repo has package smoke tests and a
   Bun/Deno/Workers smoke script, but local validation depends on external
   runtimes being installed.
3. **Browser IndexedDB performance proof:** the implementation has modern browser
   knobs such as relaxed durability and Storage Buckets, but performance claims
   should stay bounded to measured browser/version combinations.

### Deferred

1. **Custom levels beyond numeric compatibility:** useful for syslog/vendor
   mapping, but it touches OTLP mapping, routing, processors, typed events, and
   benchmark semantics. Keep it design-first.
2. **Disabled-method noop replacement:** only pursue if a benchmark proves a real
   benefit over the current level gate and it preserves child loggers, dynamic
   level changes, and TypeScript ergonomics.
3. **Pino-style worker module host:** defer unless runtime module resolution is
   more valuable than type safety and bundler friendliness.
4. **Generated redaction compiler:** do not add to core. Consider only as an
   optional package if there is measured demand and clear safety documentation.

## 5. Remaining Roadmap

### 5.0 Hold Surface Expansion Until the Baseline Is Boring

**Why:** The current first-party surface is already broad. More transports and
integrations are less valuable than making existing ones predictable, documented,
and validated in the runtimes where users rely on them.

The default path before v1 is:

- strengthen existing production paths before adding new ones;
- keep runtime-specific behavior outside `@loggerjs/core`;
- add new public component subpaths only with stability docs, import-boundary
  docs, size-budget evidence, and real-environment validation;
- prefer examples that compose existing processors/transports when that solves
  the use case.

**Done when:** `pnpm check`, browser E2E, live integration config/readiness, and
release docs all give maintainers the same answer about whether a public
component is ready to ship.

### 5.1 Finish Transport Metric Naming

**Why:** Users need one mental model for degradation across Node, browser,
database, and vendor transports.

Recommended stable names:

- `transport.dropped`
- `transport.dropped.<reason>`
- `transport.errors`
- `transport.queue.depth.<name>`
- `transport.backpressure.<name>`
- `transport.ready.<name>`
- `transport.circuit.open.<name>`

Avoid destination URLs, file paths, tenant ids, request ids, category names, or
other high-cardinality values in metric names.

**Done when:** built-in transports use the documented names where applicable,
`getLoggerSelfMetrics()` examples match implementation, and tests cover at least
one transport per runtime family.

### 5.2 Add Measured Browser IndexedDB Results

**Why:** The IndexedDB transport has useful high-performance options, but browser
storage performance is version- and device-sensitive.

Measure at least:

- Regular IndexedDB durability versus `durability: "relaxed"`.
- Storage Buckets available versus unavailable.
- Single-tab batch writes and multi-tab contention.
- Flush latency under quota pressure or blocked upgrades where practical.

**Done when:** `docs/BENCHMARKS.md` or a browser-specific benchmark doc lists the
browser versions, hardware, scenario, and caveats. Avoid general "fastest" claims
outside measured environments.

### 5.3 Keep Runtime Smoke Coverage Operational

**Why:** LoggerJS is explicitly isomorphic. CI should keep browser-like and
non-Node runtimes honest.

The current smoke script supports:

- `--runtime=bun`
- `--runtime=deno`
- `--runtime=workers` / `workerd` / `miniflare`

**Done when:** CI installs the required runtime binaries and runs the smoke script
for the packages that claim cross-runtime support. Local failures caused by a
missing runtime should be reported as environment gaps, not package regressions.

### 5.4 Expand Vendor Reliability Examples

**Why:** Raw vendor transports stay composable by design, but production users
need examples that make retry, batching, and fallback explicit.

For each new vendor transport, include:

- A raw minimal example.
- A production wrapper example using `batchTransport()` or `retryTransport()`.
- Failure behavior: retryable status codes, permanent drops, queue limits, and
  credential/runtime constraints.

**Done when:** vendor docs never imply raw delivery is durable or retried unless
the transport actually owns those semantics.

## 6. Validation Checklist

Use this checklist for future hardening changes:

- API changes: run typecheck, tests, API report check, and package smoke tests.
- Hot-path changes: run `pnpm bench:gate` and update documented ratios only from
  measured results.
- Node destination changes: run node transport tests, crash/exit fixtures, EPIPE
  tests, and size checks.
- Worker changes: test ready timeout, ack timeout, worker error, non-zero exit,
  fallback delivery, `flush()`, `close()`, and `autoEnd`.
- Browser transport changes: test feature fallback paths and document loss
  windows before claiming durability.
- Docs-only changes: scan for stale "currently missing" wording after the code
  lands.

## Appendix - Mapping to the Earlier 12-Point Review

| Review # | Topic | Current disposition |
| --- | --- | --- |
| 1 | Worker transport host | Lifecycle protocol implemented; module-host model remains deferred. |
| 2 | SonicBoom-style destination | Shared Node destination implemented without taking a runtime dependency on SonicBoom. |
| 3 | Transport lifecycle contract | Implemented in core and documented in concepts/transports. |
| 4 | Multi-target routing semantics | Covered through route processors, transport names, and reliability docs; keep future routing changes benchmarked. |
| 5 | Pino-compatible codec | Implemented in `@loggerjs/codecs`. |
| 6 | Redaction path compiler | Safe docs and aliases implemented; generated compiler remains deferred. |
| 7 | Custom levels | Deferred, design-first. |
| 8 | Disabled-method noop | Deferred, benchmark-gated. |
| 9 | `diagnostics_channel` | Implemented with stage-specific subscription gating. |
| 10 | Fatal / crash flush | Documented and tested with sync plus bounded async flush. |
| 11 | Browser console ergonomics | Folded into browser transport and loss-window docs; future polish should stay privacy-first. |
| 12 | Documentation discipline | Ongoing requirement: docs must distinguish measured behavior, best-effort delivery, and design intent. |
