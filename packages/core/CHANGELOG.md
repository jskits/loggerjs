# @loggerjs/core

## 1.0.0

### Major Changes

- The `@loggerjs/core` root now exports only the kernel. The 54 exports deprecated in 0.7 are removed from the root: trace propagation, semantic events, payload transforms, diagnostics, integration helpers, event routes, `metricsCodec`, `createPreparedRecordEncoder`, and `testTransport`. Import them from `@loggerjs/core/trace-propagation`, `semantic-events`, `payload-transforms`, `diagnostics`, `integration-api`, `event-route`, `codec-metrics`, `codec-prepared`, and `transport-test`; the migration guide maps every export to its subpath.

- Require Node 22 or later: every package declares `engines.node: ">=22.0.0"`, and CI smoke-tests the packed packages on Node 22.0.0, the latest Node 22, and Node 24. Node 20 is no longer supported. Each Node line a major ships with stays supported for that whole major (see GOVERNANCE).

- LoggerJS 1.0. Every `@loggerjs/*` package moves to 1.0.0. Semantic versioning covers Stable exports: no removals, renames, or signature breaks within a major. Compatible exports and Experimental packages change only after a deprecation in an earlier minor. The support windows in GOVERNANCE and SECURITY now apply to every package: the previous minor gets security and data-loss fixes for six months after the next minor ships, the last 0.x minor gets security fixes for three months, and every Node line and browser baseline a major ships with stays supported for that whole major.

## 0.7.0

### Minor Changes

- Add the `@loggerjs/core/diagnostics`, `@loggerjs/core/integration-api`, `@loggerjs/core/event-route`, and `@loggerjs/core/codec-prepared` subpath entries. Together with the existing `semantic-events`, `codec-metrics`, `transport-test`, `trace-propagation`, and `payload-transforms` subpaths, every module that leaves the `@loggerjs/core` root in 1.0 can now be imported from its own subpath.

- Deprecate the `@loggerjs/core` root exports of modules that leave the root in 1.0. They keep working in 0.x and are marked `@deprecated`, so editors flag them; import them from their subpaths instead:

  - `@loggerjs/core/trace-propagation`: `parseTraceparent`, `formatTraceparent`, `parseBaggage`, `formatBaggage`, `traceContextFromHeaders`, `traceContextToHeaders`
  - `@loggerjs/core/semantic-events`: `semanticEvents` and the `Semantic*Payload` types
  - `@loggerjs/core/payload-transforms`: `applyPayloadTransforms`, `composePayloadTransforms`, `encryptionPayloadTransform`, `encodedPayloadToUint8Array`
  - `@loggerjs/core/diagnostics`: `setLoggerDiagnosticSink` and the diagnostic helpers
  - `@loggerjs/core/integration-api`: `createIntegrationSetupContext`, `getUnpatchedRegistry`, `registerUnpatchedDefaults`, `onceTeardown`
  - `@loggerjs/core/event-route`: `withLogEventRoute`, `getLogEventRoute`, `LOGGERJS_ROUTE`
  - `@loggerjs/core/codec-metrics`: `metricsCodec`
  - `@loggerjs/core/codec-prepared`: `createPreparedRecordEncoder`
  - `@loggerjs/core/transport-test`: `testTransport` and its option types

  These subpaths are now classified Compatible Public Surface; the root kernel stays stable.

- Add `onDrop(event, reason)` to `retryTransport()` and `fallbackTransport()`. When a wrapper gives up on a delivery, it now counts the events in `transport.dropped` and `transport.dropped.<reason>` and hands each one to `onDrop`, with reason `retry-exhausted` (retries ran out and there is no fallback), `circuit-open` (the circuit was open and there is no fallback), or `fallback-failed` (the fallback failed too). Previously only `transport.retry.exhausted` and `transport.circuit.skipped` were counted, and callers could not tell which events were lost. The delivery still rejects as before, and an `onDrop` callback that throws is reported as an internal error without replacing the delivery error.

- Honor `Retry-After`. HTTP transports now throw `httpStatusError()` for non-2xx responses, which carries `status` and, when the response sends `Retry-After` (delay-seconds or an HTTP-date), `retryAfterMs`. `batchTransport()` and `retryTransport()` wait at least that long before the next attempt. A wait longer than `retryMaxDelayMs` ends the current retries instead: `batchTransport()` puts the batch back and sends nothing until the wait ends (counted as `transport.retry.deferred`), and `retryTransport()` gives up with reason `retry-exhausted`, so `flush()` and `close()` are never held by a long server-requested wait. `browserHttpTransport()` pauses scheduled, full-batch, and explicit sends and offline replay until the wait ends; cross-origin collectors must expose `Retry-After` through `Access-Control-Expose-Headers`.

  `parseRetryAfter()` and `httpStatusError()` are exported from `@loggerjs/core` for custom HTTP transports. Error messages are unchanged.

- Add `configure({ shareAcrossCopies })` for processes that load more than one copy of `@loggerjs/core`, such as an ESM application with a CJS library, or two installed versions. Each copy keeps its own registry, ambient context, and meta counters, so a library's `getLogger()` in another copy ignored the application's `configure()` and its logs were silently dropped.

  - `shareAcrossCopies: true` moves that state into one process-wide store that every copy uses, so libraries in other copies log through the application's configuration.
  - `shareAcrossCopies: false` keeps copies isolated, which is what independently bundled micro-frontends on one page want.
  - Left unset, behavior is unchanged, and `configure()` warns once when it sees more than one copy loaded.

- Smaller application bundles. `createLogger()` with `consoleTransport()` drops from about 6.3 KB to 5.5 KB gzip after tree-shaking and minification, `browserHttpTransport()` from 8.5 KB to 7.8 KB, and `stdoutTransport()` from 6.9 KB to 6.2 KB.

  - New `safeJsonEncoder()` and `ndjsonEncoder()` in `@loggerjs/core/codec-json` are `safeJsonCodec()` and `ndjsonCodec()` without `decode()`. Transports that only send logs (browser and Node HTTP, WebSocket, worker, database, Node stdout and file) default to them, and `consoleTransport({ pretty: false })` encodes the same way, so apps that never decode leave out the payload validation. Output is unchanged.
  - Diagnostics instrumentation is removed entirely from bundles that never install a diagnostics sink, instead of leaving inert checks behind.

### Patch Changes

- Declare `engines.node: ">=20.19.0"`, the oldest Node release the packed packages are smoke-tested on in CI. Package managers can now warn when LoggerJS is installed on an older Node.

- Keep `error.cause` chains in logs written with native-JSON codecs. The logger copied an `Error` cause into the serialized error as the `Error` instance itself, and `jsonCodec()`, `ndjsonCodec()` (the default for file, rotating-file, and stdout transports), and `fastEventJsonCodec()` encode with `JSON.stringify`, which turns an `Error` into `{}`, so every cause was written as `"cause":{}`. Error causes are now serialized like the top-level error (name, message, stack, code, and their own cause), with circular causes written as `"[Circular]"` and chains cut off after eight levels.

- Add `idempotencyKeyHeader` to `nodeHttpTransport()` and `browserHttpTransport()`. When set (for example to `"Idempotency-Key"`), each request carries a key made of a random per-transport prefix and a batch number. Every resend of a batch repeats its key, including retries after a timeout, resends after the batch went back to the queue, and browser offline replays (offline entries store the key), so a collector can drop the duplicates that a retry after a timeout may cause. The option is off by default. A cross-origin collector must allow the header in `Access-Control-Allow-Headers`, and Beacon requests cannot carry it. An invalid header name throws a `TypeError` when the transport is created.

  `batchTransport()` and `browserHttpTransport()` now resend a batch that went back to the queue after a failed delivery as the same batch. Newer events wait behind it instead of joining it.

- With `configure({ shareAcrossCopies: true })`, the copy of `@loggerjs/core` that called `configure()` now builds every registry logger, whichever copy calls `getLogger()`. A diagnostics sink installed through that copy with `setLoggerDiagnosticSink()` therefore sees the registry loggers of libraries that load another copy, such as a CJS library in an ESM app. The sink itself stays per copy, so bundles that never install one still drop the diagnostics code. A configuration written by an older copy falls back to the reading copy's own logger.

## 0.6.0

### Minor Changes

- `logger.flush()` and `logger.close()` now wait for asynchronous transport writes that are still in flight, including writes started by child loggers, before flushing or closing the transports. `retryTransport()` and `fallbackTransport()` also track their in-flight deliveries, so their own `flush()` and `close()` wait for them. Previously, logs sent through these wrappers or through raw vendor transports could still be on the wire when `flush()` resolved, and were lost on shutdown. `flush()` and `close()` can therefore take longer than before.
- Calling `configure()` again without `reset: true` now replaces the previous configuration instead of leaking it. Previously the earlier integrations stayed installed (so console, fetch, and similar hooks were patched twice and captured duplicates) and transports dropped from the configuration were never flushed or closed. Reconfiguring now tears down the previous integrations before installing the new ones and closes transports that are no longer referenced; transports passed again stay open.

### Patch Changes

- Make `batchTransport().close()` clean up when the destination is failing. Previously a failed final flush made `close()` reject without closing the inner transport, and the retry timer kept firing after close. Close now stops the timer, always closes the inner transport, counts undelivered records (and any written after close) as `transport.dropped.closed`, and is idempotent. The final flush error is still thrown.
- Let string codecs be passed to transports under strict TypeScript. `Codec.decode` was declared as a function-typed property, which made its payload parameter contravariant, so `stdoutTransport({ codec: ndjsonCodec() })` or `nodeHttpTransport({ codec: fastEventJsonCodec() })` failed to compile because `Codec<string>` was not assignable to `Codec<string | Uint8Array>`. `decode` is now declared with method syntax.
- Forward `ready()` through wrapper transports. `batchTransport()`, `retryTransport()`, and `fallbackTransport()` did not expose the wrapped transport's `ready()`, so `logger.ready()` stopped waiting for startup handshakes (for example a worker or WebSocket transport) as soon as it was wrapped. Wrappers now expose `ready()` whenever a wrapped transport has one.

## 0.5.6

### Patch Changes

- Version alignment for package release `0.5.6`.
- No core runtime source changes landed between the `0.5.5` and `0.5.6` package releases.

## 0.5.5

### Patch Changes

- Version alignment for package release `0.5.5`.
- No core runtime source changes landed between the `0.5.4` and `0.5.5` package releases.

## 0.5.4

### Patch Changes

- Version alignment for package release `0.5.4`.
- No core runtime source changes landed between the `0.5.3` and `0.5.4` package releases.
- Added repository coverage-ratchet documentation and refreshed the measured coverage snapshot used by quality gates.

## 0.5.3

### Patch Changes

- `jsonCodec()`, `safeJsonCodec()`, and `ndjsonCodec()` now validate decoded log-event payloads before returning typed values, rejecting malformed objects, invalid levels, non-finite numbers, invalid tags, and invalid serialized errors.
- Pointed core subpath exports at physical bundles for codecs, transports, context, events, semantic events, trace propagation, middleware, and payload transforms.
- Raised coverage floors and expanded edge coverage around integration APIs, memory/test transports, logger dispatch, and semantic events.

## 0.5.2

- Version alignment for package release `0.5.2`.
- No package runtime source changes landed between the `0.5.1` and `0.5.2` package releases.

This changelog has been corrected against the git tag history. Untagged generated entries that were later reset are folded into the tagged release where their commits shipped.

## 0.5.1

- Kept the core public type surface and source typecheck compatible with TypeScript projects that do not include DOM libs.
- Added no-DOM platform type verification for the package source and exported API report.

## 0.5.0 - 2026-06-15 (repository tag `v0.5.0`)

- Version alignment for repository tag `v0.5.0`.
- No package runtime source changes landed between `v0.4.0` and `v0.5.0`.

## 0.4.0 - 2026-06-15 (repository tag `v0.4.0`)

- Version alignment for repository tag `v0.4.0`.
- Release focused on docs site, generated references, localization, agent skill docs, and npm Trusted Publisher/OIDC workflow hardening.

## 0.3.1 - 2026-06-14 (repository tag `v0.3.1`)

- Hardened record/error contracts and hostile input handling.
- Optimized the lean record path by avoiding unnecessary context/middleware allocations.
- Added prepared record encoders for stable logger/tag fragments.

## 0.3.0 - 2026-06-13 (repository tag `v0.3.0`)

- Added explicit transport readiness semantics.
- Gated diagnostics by subscribed stage and closed transports without fallback flush when `close()` owns the lifecycle.
- Updated transport lifecycle and reliability contracts.

## 0.1.0 - 2026-06-13 (repository tag `v0.2.0`)

- Added reliability wrappers, logger self metrics, trace context propagation helpers, semantic event conventions, and payload transform helpers.
- Fixed single-log delivery to batch transports and ambient context provider teardown.

## 0.0.2 - 2026-06-12 (package tag `@loggerjs/core@0.0.2`)

- Republished through the explicit provenance publishing path.

## 0.0.1 - 2026-06-12 (package tag `@loggerjs/core@0.0.1`)

- Initial core package with logger creation, levels, records/events, middleware, processors, codecs, transport contracts, registry configuration, meta counters, sync/async flush, console/memory/batch/test transports, and record-aware dispatch.
