# LoggerJS Implementation Plan

> Goal: implement the `DESIGN.md` target: a high-performance isomorphic JavaScript logger with orthogonal Integration, Middleware, Transport, and transport-owned Codec boundaries.

This plan assumes the current repo is a v0 skeleton. The work should preserve enough compatibility to keep examples useful while the internals move from `LogEvent`/`Processor` toward `LogRecord`/`Middleware`.

## Guiding Decisions

- Use `DESIGN.md` as the governing spec and `docs/ARCHITECTURE.md` as the implementation architecture.
- Keep `@loggerjs/core` zero-runtime-dependency and platform-neutral.
- Do not optimize serialization in middleware. Serialization belongs to codecs inside transports.
- Do not add async middleware.
- Favor small independent packages for real v1 distribution, while retaining `@loggerjs/browser` and `@loggerjs/node` as presets.
- Every milestone must include tests and at least one runnable example or benchmark relevant to that layer.

## Phase 0: Baseline And Quality Gate

### Objectives

Establish the current repo state before refactoring so regressions are visible.

### Tasks

1. Install dependencies and record the baseline.
   - Run `pnpm install`.
   - Run `pnpm typecheck`.
   - Run `pnpm test`.
   - Run `pnpm build`.
   - Document any pre-existing failures in a short `docs/BASELINE.md` or in the first implementation PR.

2. Add basic repo hygiene if missing.
   - Add a root `format` or `lint` script only if the repo already has a chosen formatter/linter.
   - Add `git diff --check` to the local verification checklist.
   - Add a minimal CI workflow only if this repo is already meant to publish from GitHub.

3. Add first real tests around the existing skeleton.
   - Core level gate.
   - Processor drop behavior.
   - Transport error isolation.
   - Browser console integration teardown.
   - Node process integration listener teardown.

### Acceptance

- Baseline commands and any failures are recorded.
- The repo has at least one meaningful test per current package category before large rewrites start.

## Phase 1: Public Vocabulary And Compatibility Layer

### Objectives

Align the API language with the target architecture without breaking every existing file at once.

### Tasks

1. Introduce `Middleware` alongside the current `Processor`.
   - Add `Middleware` and `MiddlewareContext` target types in `packages/core/src/types.ts`.
   - Keep `Processor` as a compatibility alias or adapter during migration.
   - Rename docs and exports gradually: `processors` package can keep old names while adding `middleware` exports.

2. Introduce `LogRecord` as the internal target type.
   - Add `BoundContext`, `LogRecord`, `CaptureInput`, and `EncodeContext`.
   - Implement `createRecord()` in core with fixed field assignment order.
   - Add `cloneRecord(record, patch)` for per-transport copy-on-write.
   - Add `resolveMessage(record)`.

3. Keep `LogEvent` as a projection.
   - Implement `recordToEvent(record)` for compatibility codecs/transports.
   - Mark `LogEvent` as compatibility-facing in docs/comments, not the hot path future.

4. Normalize naming.
   - Prefer `category` over `logger`/`name` in new APIs.
   - Preserve `name` options in presets temporarily by translating to category arrays.
   - Add category helpers: string to `[string]`, dot path to segments only where explicitly requested.

### Files

- `packages/core/src/types.ts`
- `packages/core/src/logger.ts`
- `packages/core/src/index.ts`
- `packages/processors/src/index.ts`
- `README.md`
- `docs/ARCHITECTURE.md`

### Tests

- `createRecord()` fixed shape and fields.
- `cloneRecord()` keeps all fields and applies patches.
- `resolveMessage()` calls lazy function at most once.
- `recordToEvent()` preserves current public event fields.

### Acceptance

- Current examples still run through the compatibility path.
- New internal record helpers are covered and ready for the logger rewrite.

## Phase 2: Core Logger Rewrite

### Objectives

Make the logger hot path match the target: level gate first, lazy message support, error slot, category, context, and transport fan-out.

### Tasks

1. Rewrite `Logger` around `LogRecord`.
   - Store numeric `minimumLevelValue` on the logger.
   - Make disabled calls return before context merge, message conversion, ID creation, or record allocation.
   - Add overloads:
     - `log.info(message, props?)`
     - `log.error(error, message?, props?)`
     - `log.debug(() => message, props?)`
   - Add `isLevelEnabled(level)`.

2. Implement child logger behavior.
   - `child(bindings)` flattens and freezes bound context.
   - Child logger inherits middleware/transports by immutable snapshot.
   - Child creation can be slower; logging must stay cheap.

3. Add registry mode.
   - `getLogger(category)` returns a void logger before configuration.
   - `configure(options)` installs immutable runtime routing snapshots.
   - `configure({ reset: true })` disposes replaced transports/integrations.
   - `earlyBuffer` optional ring buffer stores pre-config records and replays after configuration.

4. Add meta logger and internal counters.
   - Report middleware failures, transport failures, integration setup failures, queue drops, and loop guard drops.
   - Rate-limit meta output.
   - Use unpatched console where available.

5. Add integration manager.
   - Install integrations through `IntegrationAPI`, not direct `LoggerLike`.
   - Ensure setup is idempotent per configured integration instance.
   - Ensure teardown reverses patches and listeners.

### Files

- `packages/core/src/logger.ts`
- `packages/core/src/types.ts`
- `packages/core/src/registry.ts`
- `packages/core/src/record.ts`
- `packages/core/src/meta.ts`
- `packages/core/src/integration-api.ts`
- `packages/core/src/levels.ts`

### Tests

- Disabled path does not call lazy message, context provider, ID factory, middleware, or transport.
- Error-first overload stores the raw error in `err`.
- Lazy messages are resolved only when needed.
- `getLogger()` before configure is void.
- `configure()` routes category prefixes correctly.
- `reset: true` disposes old transports.
- Early buffer replays in order and respects max size.

### Acceptance

- Core logger no longer depends on `LogEvent` for the hot path.
- Existing v0 API either still works through adapters or has an intentional migration note.

## Phase 3: Middleware System

### Objectives

Replace ad hoc processors with the target synchronous middleware model and copy-on-write rules.

### Tasks

1. Implement middleware execution.
   - Global middleware runs before fan-out.
   - Per-transport middleware runs after routing.
   - Global middleware may mutate.
   - Per-transport middleware must clone for changes.
   - Dev mode optionally freezes sampled records to catch illegal mutation.

2. Port existing processors.
   - `redactProcessor` -> `redact`
   - `sampleProcessor` -> `sample`
   - `dedupeProcessor` -> `dedupe`
   - `tagsProcessor` -> `tags`
   - `typeProcessor` -> `type`
   - `contextProcessor` -> `enrichContext`
   - `traceContextProcessor` -> `traceContext`

3. Add missing built-ins.
   - `rateLimit`
   - `fingersCrossed`
   - `enrich`
   - minimum-level middleware only if routing does not cover the use case

4. Optimize redaction.
   - Compile exact paths and wildcard paths.
   - Use copy-on-write only for matched branches.
   - Avoid mutate-restore because async transports may hold references.
   - Preserve Error/Date/URL/RegExp objects unless explicitly configured.

5. Add middleware diagnostics.
   - Count drops per middleware.
   - Count thrown errors.
   - Optional dev threshold for slow middleware.

### Files

- `packages/core/src/middleware/*`
- `packages/processors/src/*` compatibility re-exports
- `packages/core/src/record.ts`
- `packages/core/src/logger.ts`

### Tests

- Middleware drop stops dispatch.
- Thrown middleware error is reported and pipeline continues.
- Per-transport middleware cannot leak changes into another transport.
- Redaction does not mutate user input unexpectedly unless documented.
- Sampling never drops error/fatal by default.
- Dedupe and rateLimit produce drop counters.
- `fingersCrossed` releases buffered records on trigger.

### Acceptance

- New middleware APIs are documented.
- Compatibility exports keep current examples working or are updated in the same phase.

## Phase 4: Codec Layer

### Objectives

Make codecs batch-oriented, transport-owned, and optimized for both fast JSON and rich symmetric decode.

### Tasks

1. Replace the current codec interface.
   - `encode(batch, encodeContext)` accepts readonly `LogRecord[]`.
   - `decode(payload)` returns unknown decoded records or wire values.
   - Provide compatibility adapters for current `LogEvent` codecs while migrating transports.

2. Implement `jsonCodec`.
   - Output NDJSON by default for log pipelines.
   - Fixed field ordering.
   - Native `JSON.stringify` for ordinary props.
   - Safe fallback only for props/error branches that throw.
   - Error encoding with name/message/stack/cause/AggregateError.
   - Record byte truncation with a `truncated` marker.

3. Implement `structuredCodec`.
   - Create `packages/codec-structured` or `packages/codecs/src/structured`.
   - Write `SPEC.md` for the value-pool wire format.
   - Encode/decode Error, AggregateError, cause chains, circular/shared refs, BigInt, Date, RegExp, URL, Map, Set, TypedArray, ArrayBuffer, `undefined`, `NaN`, infinities, and `-0`.
   - Encode functions and symbols lossy with markers.
   - No eval, no `new Function`, no recursive reviver.

4. Implement `msgpackCodec`.
   - Keep the current `msgpackr` runtime adapter.
   - Benchmark adapter vs any custom subset before deciding whether to self-implement.
   - Add field dictionary support only after benchmark evidence.

5. Add schema event encoding.
   - Implement `defineEvent(name, shape)`.
   - Add `log.event(def, payload)`.
   - Cache shape-specific stringifier fragments in `EncodeContext.schemaCache`.
   - Keep runtime validation out of the hot path.

### Files

- `packages/core/src/codecs/*`
- `packages/codecs/src/*`
- `packages/codec-structured/*` if split now
- `packages/core/src/events.ts`
- `packages/core/src/types.ts`

### Tests

- JSON codec does not throw on circular props or BigInt.
- JSON codec truncates oversized records.
- Structured codec property tests for round-trip equality classes.
- Structured codec preserves shared references and cycles.
- Structured decode is CSP-safe.
- `defineEvent` type tests infer payload.

### Acceptance

- Every transport can choose its codec.
- No middleware or logger code serializes records.

## Phase 5: Transport Layer

### Objectives

Build reliable, bounded, observable delivery primitives for console, HTTP, file/stdout, worker, OTLP, and adapters.

### Tasks

1. Replace `batchTransport()` with a target batching base.
   - `maxRecords`
   - `maxBytes`
   - `maxWaitMs`
   - `concurrency`
   - retry policy
   - full jitter
   - queue overflow policy
   - drop hooks
   - circuit breaker
   - encoded-size estimates
   - no idle timers

2. Update console transport.
   - Pretty mode passes raw references.
   - JSON mode uses codec.
   - Always uses unpatched console registry.
   - Default filter excludes console integration loops in presets.

3. Update browser HTTP transport.
   - Shared batching base.
   - `fetch` normal send.
   - `sendBeacon` on pagehide/hidden.
   - Split beacon payloads around the 64 KiB practical budget.
   - Optional offline queue adapter.
   - Store encoded payloads in offline queue.
   - Replay on online with retry/backoff.

4. Update Node HTTP transport.
   - Shared batching base.
   - global `fetch`/undici.
   - retry/circuit breaker.
   - no `flushSync` claim.

5. Update stdout/stderr/file.
   - NDJSON default.
   - `stdoutTransport` and `stderrTransport` handle backpressure reasonably.
   - `fileTransport` adds real `flushSync()`.
   - Add crash-path tests.

6. Add worker transport.
   - Node `worker_threads` host package.
   - Transfer encoded `Uint8Array` buffers.
   - Inline fallback on worker failure.
   - No sync flush.

7. Harden OTLP transport.
   - Map `LogRecord` to OTLP JSON.
   - Put `category` into instrumentation scope.
   - Map error fields to exception semantic attributes.
   - Map trace/span context.
   - Add collector demo.

8. Add Sentry adapter.
   - Peer dependency on Sentry core.
   - Map records to structured logs.
   - Optional error event capture for error/fatal.

### Files

- `packages/core/src/transports/*`
- `packages/browser/src/http-transport.ts`
- `packages/node/src/http-transport.ts`
- `packages/node/src/stdout-transport.ts`
- `packages/node/src/file-transport.ts`
- `packages/otel/src/*`
- new transport packages if split now

### Tests

- Queue overflow `drop-old` and `drop-new`.
- Retry success after transient failures.
- Retry exhausted increments counters.
- Circuit breaker opens and half-opens.
- `flush()` sends pending records.
- Browser pagehide uses beacon when possible.
- Offline queue stores encoded payload and replays.
- File `flushSync()` writes before process exit.
- OTLP JSON validates against expected shape.

### Acceptance

- Transport failures never throw into application code.
- All drop paths are counted.
- Browser and Node examples use the new transports.

## Phase 6: Integration Layer

### Objectives

Make automatic collection explicit, reversible, loop-safe, and privacy-safe.

### Tasks

1. Implement core `IntegrationAPI`.
   - `capture(input)` creates `LogRecord` with `source = integration:<name>`.
   - `guard(fn)` prevents reentrant capture.
   - `unpatched` registry stores original console/fetch/XHR functions.
   - Integration setup and teardown are idempotent.

2. Rewrite console integration.
   - Capture log/info/warn/error/debug/trace.
   - Preserve original console output by default.
   - Rate-limit capture to prevent storms.
   - Preserve original arguments in props only when enabled.
   - Document DevTools call-site tradeoff.

3. Rewrite browser global errors.
   - Capture script errors.
   - Capture resource load errors.
   - Capture unhandled promise rejections.
   - Optional `securitypolicyviolation`.
   - Deduplicate cross-origin `"Script error."` storms.

4. Rewrite fetch/XHR integration.
   - Capture method, sanitized URL, status, duration, and network errors.
   - Default only status >= 400 and network errors.
   - `captureAll` requires sampling guidance.
   - Headers/body only through allowlists.
   - Avoid traceparent injection; leave that to OTel instrumentation.

5. Rewrite page lifecycle integration.
   - Flush on hidden/pagehide.
   - Coordinate with HTTP transport so duplicate listeners do not cause duplicate work.

6. Rewrite Node process integration.
   - `uncaughtException`
   - `unhandledRejection`
   - `warning`
   - `beforeExit` and `exit`
   - default `exitOnUncaught: true`
   - sync flush where available, bounded async flush otherwise
   - preserve exit semantics

7. Add diagnostics_channel integration.
   - Subscribe to Node HTTP/undici channels when available.
   - Do not monkey-patch Node HTTP as fallback.
   - Keep it optional and no-op when channels are absent.

### Files

- `packages/core/src/integration-api.ts`
- `packages/browser/src/console-integration.ts`
- `packages/browser/src/error-integration.ts`
- `packages/browser/src/fetch-integration.ts`
- `packages/browser/src/xhr-integration.ts`
- `packages/browser/src/page-lifecycle.ts`
- `packages/node/src/process-integration.ts`
- `packages/node/src/diagnostics-integration.ts`

### Tests

- Console integration + console transport does not recurse or duplicate.
- Teardown restores original console/fetch/XHR.
- Global error handlers remove listeners.
- Fetch integration rethrows original network errors.
- XHR integration captures status and network errors once.
- Process integration flushes and exits correctly in child process.
- diagnostics_channel integration no-ops safely when unavailable.

### Acceptance

- All integrations are opt-in.
- All patches are reversible.
- Privacy defaults are tested.

## Phase 7: Context, Trace, And Events

### Objectives

Complete context propagation, OTel bridge, and typed/schema events.

### Tasks

1. Implement explicit context fully.
   - Frozen child bindings.
   - Immutable bound context identity for codec cache.
   - Conflict rules documented.

2. Implement implicit context.
   - Node/Bun/Deno conditional export using AsyncLocalStorage-compatible API.
   - Browser synchronous fallback.
   - `withContext`, `getContext`, and `setContextProvider`.

3. Implement OTel bridge.
   - Peer dependency on `@opentelemetry/api`.
   - Middleware reads active span.
   - OTLP/Sentry transports recognize trace/span fields.

4. Implement typed events.
   - `defineEvent`.
   - `log.event`.
   - Shape-lite type mapping.
   - Optional Standard Schema adapter later.

### Tests

- Child context accumulates types and runtime values.
- AsyncLocalStorage context propagates across awaits in Node.
- Browser fallback is documented and tested for synchronous scope only.
- OTel trace middleware no-ops without active span.
- Event payload type tests catch invalid payloads.

### Acceptance

- Library authors can use `getLogger()` and application authors can route by category/context/event.

## Phase 8: Package Topology And Build

### Objectives

Move from coarse v0 packages to installable v1 surfaces without losing preset ergonomics.

### Tasks

1. Decide split timing.
   - Either split packages during implementation or keep source coarse and publish subpath exports first.
   - Prefer no user-facing package churn after beta.

2. Convert to ESM-only.
   - Remove CJS output after compatibility decision.
   - Use conditional exports for browser/node/edge where needed.
   - Verify Node 20.19+ `require(esm)` expectations if documented.

3. Add subpath exports.
   - `@loggerjs/core/middleware`
   - `@loggerjs/core/codec-json`
   - `@loggerjs/core/transport-console`
   - platform transport/integration entries

4. Add API locking.
   - API Extractor or equivalent report for public packages.
   - Type tests for key generic behavior.

5. Add changesets and publish metadata.
   - npm provenance.
   - package files validation.
   - release dry-run.

### Tests

- Build all packages.
- Import tests for ESM and conditional exports.
- Bundle-size checks.
- `npm pack --dry-run --json` for release packages.

### Acceptance

- Public package layout matches README/docs.
- Core remains zero runtime dependencies.

## Phase 9: Benchmarks And Size Budgets

### Objectives

Make performance claims evidence-backed.

### Tasks

1. Add benchmark harness.
   - Use `mitata` or a similarly stable benchmark runner.
   - Add Node benchmarks.
   - Add Playwright browser benchmarks.

2. Benchmark scenarios.
   - Disabled level call.
   - Enabled record construction.
   - Enabled with 3 middleware.
   - Console transport raw path.
   - NDJSON stdout path.
   - HTTP batch encode path.
   - JSON codec ordinary props.
   - JSON codec circular/BigInt fallback.
   - Structured codec encode/decode.
   - msgpack adapter encode/decode.

3. Compare baselines.
   - pino
   - winston
   - LogTape
   - native console
   - native `JSON.stringify`
   - current v0 LoggerJS if still available

4. Add size budgets.
   - core <= 4 KB min+gzip target
   - integration <= 1.5 KB each target
   - codec and transport budgets documented separately

5. Publish benchmark methodology.
   - Hardware.
   - Runtime versions.
   - Command lines.
   - Dataset shapes.
   - Raw output.

### Acceptance

- Benchmark output is reproducible.
- v1 beta does not publish performance claims without benchmark data.

## Phase 10: Examples And Documentation

### Objectives

Turn the architecture into usable product surfaces.

### Tasks

1. Update README first-screen examples.
   - Browser quick start.
   - Node quick start.
   - Registry/library example.
   - OTLP collector example.

2. Update package READMEs.
   - Each package explains only its install surface and runtime constraints.
   - Preset packages explain what they include.

3. Add examples.
   - browser basic
   - Node service
   - edge worker
   - OTLP collector
   - Sentry adapter
   - library author using `getLogger()`

4. Add migration guides.
   - from `console.log`
   - from pino
   - from winston
   - from LogTape-style library logging
   - from Sentry/Faro when only log pipeline is desired

5. Add operational docs.
   - privacy defaults
   - browser offline queue implications
   - crash flush limitations
   - integration loop prevention
   - performance tuning
   - codec tradeoffs

### Acceptance

- A new user can run browser and Node examples without reading source.
- Privacy and reliability limitations are explicit.

## Phase 11: Release Readiness

### Objectives

Prepare for public beta and v1.

### Tasks

1. Beta checklist.
   - Core API report stable.
   - Browser and Node examples pass.
   - OTLP demo works.
   - Benchmarks have initial published baseline.
   - Integration loop tests are permanent.
   - Crash flush tests are permanent.

2. Real project trials.
   - Trial in at least one browser app.
   - Trial in at least one Node service.
   - Trial with one OTLP collector backend.
   - Collect API pain points before v1 lock.

3. v1 checklist.
   - SemVer policy.
   - API report locked.
   - Package topology stable.
   - Migration docs complete.
   - Security/privacy defaults reviewed.
   - Publish dry-run verified.

### Acceptance

- v1 is not just code-complete; it is documented, benchmarked, tested across runtimes, and trialed in real applications.

## Deferred Until After v1

- Object pools or SharedArrayBuffer ring buffers.
- Browser Web Worker transport as a default path.
- Code-generated schema stringifiers that violate strict CSP.
- Automatic traceparent injection in fetch/XHR.
- Framework-specific integrations beyond thin examples.
- Session replay.
- Metrics and tracing as first-class signals.
- A proprietary storage/query backend.

## Suggested First Implementation Slice

Start with the smallest slice that validates the architecture:

1. Add `LogRecord`, `createRecord`, `cloneRecord`, and `resolveMessage`.
2. Rewrite core logger hot path around `LogRecord`.
3. Add compatibility projection to existing `LogEvent` transports.
4. Port `redact`, `sample`, and `tags` to middleware.
5. Rewrite console transport to use raw values and unpatched console.
6. Add the console integration loop regression test.
7. Run Node example and browser example.

This slice proves the hardest boundary: manual logs and integration logs can share one pipeline without serializing before transport and without console recursion.
