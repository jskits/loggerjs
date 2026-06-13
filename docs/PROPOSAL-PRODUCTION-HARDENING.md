# Proposal: Production Hardening - Lessons from Pino

**Status:** Implementation baseline
**Date:** 2026-06-13
**Scope:** `@loggerjs/node`, `@loggerjs/core`, `@loggerjs/codecs`, browser transports,
vendor transports, docs

> This proposal records the baseline that motivated the production-hardening work.
> Some baseline rows intentionally describe the pre-implementation state; use the
> package docs and API reports as the current behavior reference.

## 1. Thesis

LoggerJS should **not** adopt Pino's "assemble the NDJSON line in the core from
call arguments" model. That trade is already decided in
[ARCHITECTURE.md](ARCHITECTURE.md) and [README.md](../README.md): LoggerJS allocates
one `LogRecord` per log so middleware, integrations, and multiple transports can
observe structured values, and serialization stays at the codec boundary.

The useful lesson from Pino is its **production engineering discipline**:
predictable destination lifecycles, explicit flush and exit semantics, worker
failure boundaries, honest documentation, and low-friction migration. LoggerJS
already has the measured performance half (`bench:gate`) and observable
degradation primitives (`getLoggerMetaStats()` / `getLoggerSelfMetrics()`). The
remaining gap is **operational predictability**: what is ready, what can be flushed,
what may be lost, and how users can see degradation before it becomes an outage.

### Guiding principles

- Harden the current architecture instead of narrowing it.
- Keep provider-, format-, and platform-specific behavior in transport, codec, or
  processor packages. Core should define contracts, not vendor policy.
- Prefer type-safe, tree-shakeable, object-passing APIs over runtime string module
  resolution.
- Do not wait in the log hot path for transport readiness.
- Every meaningful degradation should be observable through counters, gauges, or an
  explicit callback.
- Browser guarantees must be phrased as best-effort delivery windows, not durable
  delivery promises.

### Non-goals

- Rebuilding core into a Pino-style direct line assembler.
- Merging user data onto the root envelope by default. LoggerJS keeps user data under
  `data` to avoid collisions with `level`, `time`, `msg`, and transport-owned fields.
- Putting pretty-printing, vendor formatting, or generated/`eval` redaction into core.
- Adopting Pino's `target` / `targets` string module host as the primary worker API.
- Optimizing a single microbenchmark at the cost of middleware, integrations,
  routing, or codec ownership.

## 2. Baseline State Before This Plan

| Area | Baseline state | Hardening implication |
| --- | --- | --- |
| Transport interface | `Transport` has `write`, `writeBatch`, `log`, `logBatch`, `flush`, `flushSync`, and `close`; it has no `ready` contract. | Add lifecycle semantics deliberately before wiring broad metrics or worker startup behavior. |
| Meta metrics | Core has global counters and gauges through `getLoggerSelfMetrics()`. Batch transport already reports queue and circuit gauges. | Metrics plumbing exists, but naming and per-transport coverage are inconsistent. |
| Vendor reliability | `otlpHttpTransport()` self-wraps `batchTransport`; Datadog, Elastic, Loki, and CloudWatch expose raw `logBatch` delivery and rely on caller-supplied wrappers. | Keep the raw model for composability, but make reliability posture explicit in docs and examples. |
| Node destinations | `stdoutTransport` handles callback completion, drain, and write errors. `fileTransport` uses `createWriteStream` and tracks pending payloads separately. `rotatingFileTransport` writes synchronously. | The three sinks diverge. A shared destination primitive should unify backpressure, EPIPE, buffering, sync mode, and exit flush. |
| File crash flush | `fileTransport.flushSync()` writes pending payloads through a separate fd. This is useful for crash paths, but the original async stream may still complete later if the process continues. | Destination work should define whether `flushSync()` is crash-only, drain-only, or deduplicated. |
| Worker transport | `workerTransport` handles create errors, worker errors, non-zero exits, transfer buffers, terminate, and fallback. It has no ready handshake, `readyTimeoutMs`, ack/flush protocol, or process-exit finalization. | Add lifecycle and observability without changing the object-passing API into a module-resolution host. |
| Routing | Record fast path does not route because routes are attached by processors on the event path. | Tests and docs must make `minLevel`, processor routes, and record fast path behavior explicit. |
| Pino-shaped output | `fastEventJsonCodec({ includeId: false, includeSeq: false, includeLevelName: false })` produces a lean envelope, but it is not a full Pino compatibility preset. | Add a dedicated compatibility codec/projector instead of overloading the performance codec's option names. |
| Browser transports | IndexedDB, offline-first, browser HTTP beacon/pagehide mode, WebSocket, Service Worker, and BroadcastChannel paths already count many drops. | Documentation should spell out loss windows per transport. Do not imply guaranteed delivery on tab close or offline replay. |
| Crash handling | `captureProcessIntegration({ exitOnUncaught })` captures fatal exceptions, calls `flushSync()`, then runs a bounded async flush before exit. | The behavior exists, but the public fatal/crash-flush contract and tests are not strong enough. |
| Redaction | `redactProcessor` and `privacyGuardProcessor` exist. The no-codegen safety posture is already correct. | Polish docs and aliases; avoid breaking option names only to mimic Pino. |

## 3. Workstreams

### Tier 0 - Contract Before Broad Implementation

#### 0.1 Define Transport Lifecycle Semantics

**Problem:** Adding `ready?()` everywhere without semantics will create inconsistent
behavior across Node, browser, worker, and vendor transports.

**Proposal:**

- Add a design note before large code changes.
- Prefer `ready?: () => Promise<void>` over `ready?: Promise<void>` so transport state
  can be lazy and retryable.
- Add `logger.ready()` only as an explicit opt-in. Normal `logger.info()` calls must
  never await transport readiness.
- Define ordering:
  - `ready()` means the transport is initialized enough to accept writes.
  - `flush()` means accepted writes are handed to the destination or durable queue.
  - `flushSync()` is only for transports that can complete synchronously.
  - `close()` implies no future writes, then best-effort flush, then resource release.
    Because core currently calls `transport.close?.() ?? transport.flush?.()`, a
    transport that implements `close()` must own its own flush-before-release
    behavior unless core is deliberately changed to call both.
- Define what happens when `ready()` fails: fallback, counted drop, or surfaced
  internal error depending on transport options.
- Define metric names before implementation: queue depth, last error, dropped count,
  backpressure, circuit state, ready state.

**Scope & risk:** Design plus small core type/API changes. Medium risk because it
touches public lifecycle expectations.

**Done when:** the contract is documented, `Transport` typing is updated if needed,
and at least one Node transport plus one browser transport exercise the contract in
tests.

#### 0.2 Make Reliability Posture Explicit

**Problem:** Users can read "shared batching/retry machinery" as meaning every vendor
transport is reliable by default. That is not true today, and making every vendor
transport self-wrap would reduce composability.

**Proposal:**

- Keep vendor transports raw by default unless a package explicitly documents a
  reliable wrapper.
- Add a reliability posture table to `docs/TRANSPORTS.md`:
  - raw immediate delivery
  - batched delivery
  - retried delivery
  - durable local queue
  - best-effort page-exit delivery
- Update examples so production vendor usage shows `batchTransport()` /
  `retryTransport()` unless the transport self-wraps.
- Add typed comments or option names where possible, but avoid runtime warnings on
  hot paths.

**Scope & risk:** Mostly docs and examples. Low risk.

**Done when:** every built-in and vendor transport has a documented reliability
posture and at least one production example shows the recommended wrapper stack.

### Tier 1 - Adoption and Expectation Clarity

#### 1.1 Add `pinoCompatCodec` / `pinoNdjsonProjector`

**Problem:** Pino migration is currently close but not precise. The migration doc
points users to a lean LoggerJS envelope, not a real Pino compatibility preset.

**Proposal:**

- Ship a codec or projector preset in `@loggerjs/codecs` that emits Pino-shaped NDJSON
  for the common field set:
  - `time`: epoch milliseconds
  - `level`: Pino-compatible numeric level
  - `msg`: resolved message
  - `pid` / `hostname`: optional base fields
  - user data merged according to explicit compatibility rules
  - error shape compatible with Pino's standard serializer for common fields
- Make the root merge policy explicit and safe:
  - default to no root merge, or require `mergeData: true`
  - define reserved key behavior for `time`, `level`, `msg`, `pid`, `hostname`, and
    LoggerJS-owned fields
  - document whether collisions are rejected, nested under a data key, or renamed
  - treat Pino byte-shape compatibility as opt-in, not the LoggerJS default envelope
- Keep this at the codec/projector boundary, not in core.
- Update `docs/MIGRATION.md` so Pino byte-shape migration points to this preset,
  while `fastEventJsonCodec` remains the performance codec.

**Scope & risk:** Isolated to `@loggerjs/codecs` and docs. Low architectural risk.

**Done when:** tests compare a Pino logger and LoggerJS with the preset for the common
field set, with a documented field-mapping table and explicitly documented
non-goals.

#### 1.2 Browser Failure-Boundary Documentation

**Problem:** Browser delivery is LoggerJS's moat, but it has the most subtle failure
boundaries.

**Proposal:**

- Add a "failure boundary / loss window" subsection for each browser transport and
  mode: IndexedDB, offline-first, browser HTTP, browser HTTP beacon/pagehide mode,
  WebSocket, Service Worker, and BroadcastChannel.
- State best-effort behavior plainly:
  - page hide and tab close can cut off async work
  - HTTP beacon-mode payloads are size- and user-agent-limited
  - Service Worker delivery depends on registration, activation, and worker lifetime
  - IndexedDB durability depends on browser support, quota, eviction, and configured
    durability
  - offline replay is not a guarantee if storage is unavailable or evicted
- Link recommended production combinations, such as HTTP + IndexedDB offline queue +
  page lifecycle flush.

**Scope & risk:** Docs only. Low risk.

**Done when:** browser transport docs no longer imply durable delivery where the
runtime only provides best-effort behavior.

#### 1.3 Redaction API Clarity Without Breaking Users

**Problem:** The safety posture is good, but the API and docs can be clearer.

**Proposal:**

- Document the existing `redactProcessor` and `privacyGuardProcessor` behavior in
  operational terms.
- Add non-breaking aliases only if they improve clarity, for example
  `paths` / `censor` / `remove`.
- Explicitly state that LoggerJS does not compile user-supplied redaction paths with
  `eval` or `new Function`.
- Document wildcard and deep-path costs.

**Scope & risk:** Docs first, optional aliases second. Low risk.

**Done when:** redaction docs explain safety, cost, and migration from Pino redaction
without breaking current processor options.

### Tier 2 - Node Production Primitives

#### 2.1 Shared Node Destination Primitive

**Problem:** Node sinks currently have different write, flush, backpressure, and crash
semantics. This is a correctness issue as much as a performance issue.

**Proposal:**

- Add an internal destination primitive used by stdout, stderr, file, and rotating
  file transports.
- Support:
  - callback/drain tracking
  - EPIPE as clean shutdown for stdout/stderr-like sinks
  - `minLength` buffering for high-throughput async writes
  - explicit `sync: true` for serverless, crash-path, or strict durability use
  - `mkdir` / `append` behavior for file destinations
  - consistent `flush()`, `flushSync()`, and `close()`
- Decide and test whether `flushSync()` is crash-only or must avoid duplicate writes
  if the process continues.

**Scope & risk:** Medium. It refactors heavily used transports, so it needs targeted
tests and benchmark coverage.

**Done when:** stdout, stderr, file, and rotating file share one destination path;
tests cover drain, write error, EPIPE, sync mode, async mode, close, and exit-time
flush; benchmarks confirm no regression on the current NDJSON path.

#### 2.2 Fatal and Crash-Flush Contract

**Problem:** Crash handling exists, but users do not have a strong public contract for
what `fatal`, `flushSync`, and process integrations guarantee.

**Proposal:**

- Document the current sequence for `captureProcessIntegration({ exitOnUncaught })`:
  capture fatal record, call `flushSync()`, run bounded async `flush()`, then exit.
- Clarify that remote HTTP/vendor transports should not be the only fatal-path sink.
- Keep the existing unit coverage for capture + `flushSync()` + bounded async
  `flush()`, and add a child-process/forced-exit fixture that verifies a fatal process
  record reaches a synchronous local transport before process termination.
- Defer new API names such as `captureFatal()` until the current contract is tested
  and documented.

**Scope & risk:** Docs and tests first. Low to medium risk.

**Done when:** `docs/OPERATIONS.md` and `docs/INTEGRATIONS.md` describe the fatal path,
unit tests cover the integration sequence, and a child-process fixture verifies local
synchronous durability before exit.

### Tier 3 - Worker Lifecycle

#### 3.1 Worker Transport Ready, Flush, and Exit Semantics

**Problem:** `workerTransport` can post encoded batches to a worker, but it cannot
confirm that the worker is ready, that a batch was accepted, or that process exit has
drained in-flight work.

**Proposal:**

- Keep the current object-passing model: `worker`, `workerFactory`, or `workerScript`.
- Add a small protocol:
  - worker sends `loggerjs:ready`
  - main sends `loggerjs:batch`
  - worker may ack `loggerjs:batch:ack`
  - worker may send `loggerjs:error`
- Add `readyTimeoutMs`, `autoEnd`, and counted pending-batch drops.
- Extend the public/test worker abstraction deliberately: the current `WorkerLike`
  only exposes `postMessage`, `terminate`, and `on/off` for `error` / `exit`, so
  ready/ack support requires `message` listeners, batch ids, pending-batch tracking,
  and `flush()` waiting semantics.
- Make fallback behavior explicit when readiness or posting fails.
- Do not adopt Pino's string `target` / `targets` module host in this workstream.

**Scope & risk:** Medium, contained to `@loggerjs/node` and tests.

**Done when:** the `WorkerLike` capability is updated intentionally, tests cover a
worker that never becomes ready, a worker that dies after ready, pending batch
accounting, fallback delivery, `flush()` waiting behavior, and close/terminate
behavior.

### Tier 4 - Observability and Metrics Rollout

#### 4.1 Internal `diagnostics_channel` Emission

**Problem:** LoggerJS can consume external diagnostics channels, but it does not emit
its own internal stage tracing for production debugging.

**Proposal:**

- Add optional Node-side channels for:
  - encode start/end/error
  - dispatch start/end/error
  - transport write/drop/error
  - flush start/end/error
  - worker ready/error/exit
- Guard subscriptions so unsubscribed channels do not affect hot-path performance.

**Scope & risk:** Medium. Needs benchmark gating.

**Done when:** subscribed diagnostics expose useful stage timing and failure detail,
and unsubscribed benchmark numbers stay within the existing regression threshold.

#### 4.2 Consistent Transport Metrics

**Problem:** Batch and several browser transports already expose useful counters, but
the naming is not a complete transport-wide contract.

**Proposal:**

- Roll metrics out incrementally after Tier 0 names are settled.
- Prefer stable, low-cardinality names:
  - `transport.dropped`
  - `transport.dropped.<reason>`
  - `transport.errors`
  - `transport.queue.depth.<name>`
  - `transport.backpressure.<name>`
  - `transport.ready.<name>`
  - `transport.circuit.open.<name>`
- Avoid high-cardinality destination URLs, file paths, tenant ids, or category names
  in metric names.

**Scope & risk:** Medium because it touches many transports, but can be committed in
small slices.

**Done when:** built-in transports use documented metric names, and
`getLoggerSelfMetrics()` examples match the implementation.

## 4. Deferred Work

- **Custom levels / level comparison:** useful for syslog/vendor mapping, but it
  touches OTLP mapping, routing, processors, typed events, and benchmark semantics.
  Write a design note before implementation.
- **Disabled-method noop replacement:** only pursue if a benchmark proves meaningful
  benefit over the current `logWith` gate and it preserves child loggers, dynamic
  level changes, and TypeScript ergonomics.
- **Pino-style worker module host:** defer unless users need runtime module resolution
  more than type safety and bundler friendliness.
- **Generated redaction compiler:** do not add to core. Consider only as an optional,
  clearly documented package if there is measured demand.

## 5. Suggested Sequencing

1. Update this proposal and write the lifecycle contract note.
2. Implement `pinoCompatCodec` / `pinoNdjsonProjector` and update migration docs.
3. Add browser transport failure-boundary docs.
4. Implement shared Node destination primitive with targeted tests and benchmark
   checks.
5. Document and test the fatal/crash-flush contract.
6. Add worker ready/ack/exit lifecycle.
7. Add diagnostics emission and roll out consistent transport metrics.
8. Revisit custom levels and noop-method replacement only with design and benchmark
   evidence.

## 6. Validation Plan

- Proposal/docs-only changes: review the Markdown diff and scan for accidental
  non-ASCII or overclaiming language. The current `oxfmt` target does not treat this
  standalone Markdown file as a format target.
- Codec work: package tests for `@loggerjs/codecs`, migration doc examples, and
  `pnpm bench:gate` if hot-path serialization changes.
- Node destination work: targeted node transport tests, crash/exit fixture tests,
  EPIPE tests, and `pnpm bench:node`.
- Worker lifecycle work: worker fixture tests for ready timeout, ack, exit, fallback,
  close, and pending-drop accounting.
- Metrics/diagnostics work: targeted tests plus `pnpm bench:gate` to prove
  unsubscribed overhead stays inside the current threshold.

## Appendix - Mapping to the Earlier 12-Point Review

| Review # | Topic | Disposition |
| --- | --- | --- |
| 1 | Worker transport host | Tier 3: lifecycle and protocol only; reject module-host model for now. |
| 2 | SonicBoom-style destination | Tier 2.1: shared Node destination with buffering, sync mode, EPIPE, and flush semantics. |
| 3 | Transport lifecycle contract | Tier 0.1: design first, then incremental implementation. |
| 4 | Multi-target routing semantics | Covered by Tier 0 docs/tests and transport reliability posture. |
| 5 | Pino-compatible codec | Tier 1.1: promoted as the cheapest migration lever. |
| 6 | Redaction path compiler | Tier 1.3: docs and safe aliases; no generated code in core. |
| 7 | Custom levels | Deferred, design-first. |
| 8 | Disabled-method noop | Deferred, benchmark-gated. |
| 9 | `diagnostics_channel` | Tier 4.1: emit side, benchmark-gated. |
| 10 | Fatal / crash flush | Tier 2.2: document and test current contract before adding new API. |
| 11 | Browser console ergonomics | Fold into browser failure-boundary docs and future browser transport polish. |
| 12 | Documentation discipline | Cross-cutting requirement for every workstream. |
