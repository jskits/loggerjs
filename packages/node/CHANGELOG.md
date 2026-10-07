# @loggerjs/node

## 0.7.0

### Minor Changes

- Deprecate the root re-exports of compatible components. In 1.0 the `@loggerjs/browser` and `@loggerjs/node` roots export only the core kernel and their stable components (browser: `browserHttpTransport`, the IndexedDB stores, `offlineFirstTransport`, and the console, error, context, and page-lifecycle integrations; Node: stdout, stderr, file, rotating-file, and HTTP transports, process capture, and AsyncLocalStorage context) and become stable. The other root exports keep working in 0.x and are marked `@deprecated`; import them from their subpaths, for example `captureFetchIntegration` from `@loggerjs/browser/integration-fetch` or `expressIntegration` from `@loggerjs/node/integration-express`. MIGRATION lists the subpath for every export.

- Add `idempotencyKeyHeader` to `nodeHttpTransport()` and `browserHttpTransport()`. When set (for example to `"Idempotency-Key"`), each request carries a key made of a random per-transport prefix and a batch number. Every resend of a batch repeats its key, including retries after a timeout, resends after the batch went back to the queue, and browser offline replays (offline entries store the key), so a collector can drop the duplicates that a retry after a timeout may cause. The option is off by default. A cross-origin collector must allow the header in `Access-Control-Allow-Headers`, and Beacon requests cannot carry it. An invalid header name throws a `TypeError` when the transport is created.

  `batchTransport()` and `browserHttpTransport()` now resend a batch that went back to the queue after a failed delivery as the same batch. Newer events wait behind it instead of joining it.

- Add `timeoutMs` to `nodeHttpTransport()`, defaulting to 10 seconds. Previously a collector that accepted the connection but never answered left the delivery pending until undici's five-minute headers timeout, so `logger.flush()` and `logger.close()` stalled graceful shutdown well past typical termination grace periods. A timed-out attempt now fails like any other and follows the retry settings; events still queued at `close()` are reported as `transport.dropped.closed`. Set `timeoutMs: 0` to restore the previous behavior.

  A collector may have processed a request that timed out before it answered, so a retry can deliver the same events twice. Deduplicate on the event `id` on the collector side if duplicates matter.

- Honor `Retry-After`. HTTP transports now throw `httpStatusError()` for non-2xx responses, which carries `status` and, when the response sends `Retry-After` (delay-seconds or an HTTP-date), `retryAfterMs`. `batchTransport()` and `retryTransport()` wait at least that long before the next attempt. A wait longer than `retryMaxDelayMs` ends the current retries instead: `batchTransport()` puts the batch back and sends nothing until the wait ends (counted as `transport.retry.deferred`), and `retryTransport()` gives up with reason `retry-exhausted`, so `flush()` and `close()` are never held by a long server-requested wait. `browserHttpTransport()` pauses scheduled, full-batch, and explicit sends and offline replay until the wait ends; cross-origin collectors must expose `Retry-After` through `Access-Control-Expose-Headers`.

  `parseRetryAfter()` and `httpStatusError()` are exported from `@loggerjs/core` for custom HTTP transports. Error messages are unchanged.

### Patch Changes

- Depend on `@loggerjs/core` with a caret range instead of an exact version. Upgrading `@loggerjs/core` on its own no longer forces the package manager to install a second copy of core underneath each LoggerJS package.

- Declare `engines.node: ">=20.19.0"`, the oldest Node release the packed packages are smoke-tested on in CI. Package managers can now warn when LoggerJS is installed on an older Node.

- Stop `flush()` and `close()` from hanging after a file or stream destination fails. Once a stream was destroyed by a write error such as `ENOSPC`, `EACCES`, or `EISDIR`, the next write returned `false` and the destination waited for a `drain` event that a destroyed stream never emits, so every later `logger.flush()` and `logger.close()` stayed pending forever and graceful shutdown hung. They now settle with the stream error. `WritableLike` gains an optional `destroyed` flag, which Node streams already provide.

- Never truncate a log file when a file destination reopens it. With `append: false`, a failed rotation made the next write reopen the current file with `"w"` and erase the logs already written. The configured flags now apply only to the first open; every reopen appends.

- Stop a file write that fails after `close()` from crashing the process. `fileTransport()` removed its error listener when closing, so a write error surfacing afterwards (for example `ENOSPC` while the last buffered chunk is flushed to a full disk) was an unhandled `error` event. File destinations now keep an error listener on the stream they own for its whole life.

- Import core helpers that leave the `@loggerjs/core` root in 1.0 (payload transforms, trace propagation, diagnostics, integration helpers, and event routes) from their `@loggerjs/core/*` subpaths. These packages now need `@loggerjs/core` 0.7 or later, which their dependency range already requires.

- Keep logging when `rotatingFileTransport()` cannot rotate. Previously a failed rename (for example `EBUSY` or `EPERM` while another process holds the log file open on Windows) threw out of every later write, so all subsequent logs were dropped. A failed automatic rotation is now reported through `reportInternalError` with `operation: "rotate"`, logging continues in the current file, and rotation is retried after another `maxBytes`.

- Smaller application bundles. `createLogger()` with `consoleTransport()` drops from about 6.3 KB to 5.5 KB gzip after tree-shaking and minification, `browserHttpTransport()` from 8.5 KB to 7.8 KB, and `stdoutTransport()` from 6.9 KB to 6.2 KB.

  - New `safeJsonEncoder()` and `ndjsonEncoder()` in `@loggerjs/core/codec-json` are `safeJsonCodec()` and `ndjsonCodec()` without `decode()`. Transports that only send logs (browser and Node HTTP, WebSocket, worker, database, Node stdout and file) default to them, and `consoleTransport({ pretty: false })` encodes the same way, so apps that never decode leave out the payload validation. Output is unchanged.
  - Diagnostics instrumentation is removed entirely from bundles that never install a diagnostics sink, instead of leaving inert checks behind.

- Updated dependencies:
  - @loggerjs/core@0.7.0

## 0.6.0

### Minor Changes

- **Behavior change:** `captureProcessIntegration()` no longer keeps the process alive after an unhandled promise rejection. Registering an `unhandledRejection` listener disables Node's default crash, so the integration now follows Node's `--unhandled-rejections` mode: by default it captures the rejection as `fatal`, flushes, and exits with code `1`; with `warn`, `none`, or `warn-with-error-code` it only logs (the last also sets `process.exitCode = 1`). Set the new `exitOnUnhandledRejection` option to override.

### Patch Changes

- Stop `fileTransport({ append: false })` from erasing the log file on the crash path. In async stream mode, `flushSync()` opened its synchronous file descriptor with the same `"w"` flag as the stream, which truncated everything already written before appending the fatal lines. The crash-path descriptor now always appends; `sync: true` mode still truncates once when the file is opened.
- `nodeHttpTransport()` picks up the `@loggerjs/core` `batchTransport()` fix: when the collector is failing, `close()` now stops retrying and releases resources instead of retrying after close.
- Updated dependencies:
  - @loggerjs/core@0.6.0

## 0.5.6

### Patch Changes

- Version alignment for package release `0.5.6`.
- No Node runtime source changes landed between the `0.5.5` and `0.5.6` package releases.
- Updated dependencies:
  - @loggerjs/core@0.5.6

## 0.5.5

### Patch Changes

- Version alignment for package release `0.5.5`.
- No Node runtime source changes landed between the `0.5.4` and `0.5.5` package releases.
- Updated dependencies:
  - @loggerjs/core@0.5.5

## 0.5.4

### Patch Changes

- `bullMqIntegration()` now classifies `addBulk()` calls as `publish` operations instead of the generic `other` operation.
- Added contract coverage pinning the documented Node integration boundaries: Prisma raw-query methods only, BullMQ Queue-like methods only, and Nest Express-compatible middleware only.
- Updated dependencies:
  - @loggerjs/core@0.5.4

## 0.5.3

### Patch Changes

- Pointed Node transport, integration, diagnostics, and context subpath exports at physical bundles and declaration files.
- Hardened `nodeHttpTransport()` contract coverage for missing `fetch`, non-2xx retryable batches, transform failures, binary bodies, HTTP method selection, and header precedence.
- Clarified the public scope of `prismaIntegration()`, `bullMqIntegration()`, and `nestMiddlewareIntegration()` in emitted declarations and docs: raw Prisma methods only, Queue-like BullMQ methods only, and Express-compatible Nest middleware only.
- Updated dependencies:
  - @loggerjs/core@0.5.3

## 0.5.2

- Version alignment for package release `0.5.2`.
- No package runtime source changes landed between the `0.5.1` and `0.5.2` package releases.
- Updated dependency `@loggerjs/core` to the matching release.

This changelog has been corrected against the git tag history. Untagged generated entries that were later reset are folded into the tagged release where their commits shipped.

## 0.5.1

- Split public transport/integration subpath exports into physical entry bundles so narrow imports do not point at the aggregate bundle.
- Clarified Node runtime compatibility docs: repo development uses Node >=22.13, published package smoke starts at Node 20.19.0.
- Updated dependency `@loggerjs/core` to the matching release.

## 0.5.0 - 2026-06-15 (repository tag `v0.5.0`)

- Version alignment for repository tag `v0.5.0`.
- No package runtime source changes landed between `v0.4.0` and `v0.5.0`.

## 0.4.0 - 2026-06-15 (repository tag `v0.4.0`)

- Version alignment for repository tag `v0.4.0`.
- Release focused on docs site, generated references, localization, agent skill docs, and npm Trusted Publisher/OIDC workflow hardening.

## 0.3.1 - 2026-06-14 (repository tag `v0.3.1`)

- Version alignment for repository tag `v0.3.1`; process integration tests were expanded.
- Updated dependency `@loggerjs/core` to the matching release.

## 0.3.0 - 2026-06-13 (repository tag `v0.3.0`)

- Added shared destination write handling, fatal crash flush coverage, worker lifecycle protocol, worker readiness, logger diagnostics publishing, and stream error handling.
- Fixed close-time worker listener handling and transport close fallback behavior through core dependency updates.
- Updated dependency `@loggerjs/core` to the matching release.

## 0.1.0 - 2026-06-13 (repository tag `v0.2.0`)

- Added process signal flushing, Koa/Nest/Hapi adapters, Prisma/Redis/data/job adapters, and Node compression payload transform support.
- Added packed-consumer and supported Node runtime smoke coverage.
- Updated dependency `@loggerjs/core` to the matching release.

## 0.0.2 - 2026-06-12 (package tag `@loggerjs/node@0.0.2`)

- Republished through the explicit provenance publishing path.
- Updated dependency `@loggerjs/core` to the matching release.

## 0.0.1 - 2026-06-12 (package tag `@loggerjs/node@0.0.1`)

- Initial Node package with stdout/stderr/file/rotating-file/http/syslog/worker transports, AsyncLocalStorage context, process capture, diagnostics channel, HTTP/fetch/database/queue/CLI/serverless/framework integrations, and worker offload support.
- Updated dependency `@loggerjs/core` to the matching release.
