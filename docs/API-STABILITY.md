# API Stability

LoggerJS 1.0 puts every `@loggerjs/*` package on 1.x, but how much an export promises depends on its tier. The checked-in `api-reports/` files describe every exported TypeScript declaration; this page says which tier each one belongs to.

This page is the human contract. The machine-readable classification lives in [`docs/api-stability.policy.json`](https://github.com/jskits/loggerjs/blob/main/docs/api-stability.policy.json), and `pnpm verify:api-stability` fails when a package export is missing from that policy.

## Current Policy

The stable set is a kernel: the core logger model and pipeline contracts, the primary browser and Node delivery paths, the primary browser capture integrations, Node process capture and context, and pretty output. 1.0 shipped before design partners had run that kernel in production (see `GOVERNANCE.md`), so real usage still decides which compatible and experimental components are promoted, reshaped, or deprecated.

Everything else stays public, tested, and documented, with a weaker promise: Compatible exports and Experimental packages change through a deprecation in an earlier minor instead of waiting for a major. Vendor, observability, and database packages stay Experimental until real-world usage and failure-mode validation justify promoting them.

## Status Levels

| Status | Meaning |
| --- | --- |
| Stable | Covered by semantic versioning: no removals, renames, or signature breaks within a major, except for security, data-loss, or wire-protocol correctness fixes. Additive changes ship in minors. |
| Compatible | Public and tested. A minor may change a compatible export only after an earlier minor has deprecated it with a migration path. |
| Experimental | Packages with the least production use. They follow the Compatible rule, so a breaking change needs a deprecation in an earlier minor. Use them when the current behavior fits. |

Internal source paths, `dist` file paths, generated bundle layout, private class fields, and behavior inferred only from tests are not public API in any status.

## Stable

Stable exports are tracked in `api-stability.policy.json`. The current stable packages and entry families are:

| Package | Stable surface |
| --- | --- |
| `@loggerjs/core` | The root kernel (`createLogger`/`Logger`, `getLogger`/`configure`, levels, types, record and event conversion, ambient context, typed events, middleware, meta counters, error and safe-stringify utilities, JSON codecs, and the console, memory, batch, and reliability transports) and the `middleware`, `codec-json`, `context`, `events`, `transport-console`, `transport-batch`, and `transport-reliability` subpaths. |
| `@loggerjs/browser` | The root (the core kernel plus the stable components in this row), `transport-http`, `offline-indexeddb`, `transport-indexeddb`, `offline-first-transport`, and the console, error, context, and page-lifecycle integrations. |
| `@loggerjs/node` | The root (the core kernel plus the stable components in this row), `transport-stdout`, `transport-file`, `transport-rotating-file`, `transport-http`, `integration-process`, and AsyncLocalStorage `context`. |
| `@loggerjs/pretty` | Root package, formatter, console transport, and stream transports. |

Stable semantics include:

- `createLogger(options)`, `getLogger(category)`, and `configure(...)` for application and library-safe logging.
- Logger instance methods: `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `log`, `capture`, `event`, `child`, `withTags`, `withType`, `setLevel`, `getLevel`, `isEnabled`, `isLevelEnabled`, `addTransport`, `addProcessor`, `addIntegration`, `ready`, `flush`, `flushSync`, and `close`.
- Level names and numeric values: `trace=10`, `debug=20`, `info=30`, `warn=40`, `error=50`, `fatal=60`, and `silent`.
- The pipeline interfaces for `Middleware`, `Processor`, `Transport`, `Integration`, and `Codec`, including `TransportContext.toEvent(record)` memoized projection.
- Disabled levels return before record allocation and lazy message evaluation.
- Middleware, processors, codecs, integrations, and transports are error-isolated from application code.
- Serialization remains transport-owned; middleware and processors keep values structured.

## Compatible

Compatible exports stay documented and tested, but they change through a deprecation in a minor instead of waiting for a major. Current compatible areas include:

- Core modules outside the root: `@loggerjs/core/trace-propagation`, `semantic-events`, `payload-transforms`, `diagnostics`, `integration-api`, `event-route`, `codec-metrics`, `codec-prepared`, and `transport-test`. Their `@loggerjs/core` root re-exports were deprecated in 0.7 and removed in 1.0; import them from these subpaths. `pnpm verify:api-stability` only lets a root re-export less stable modules through deprecated specifiers.
- Browser secondary transports and collectors: BroadcastChannel, service worker, WebSocket, framework errors, framework routers, generic router capture, ReportingObserver, runtime host, service worker messages, user actions, and WebSocket capture.
- Browser fetch/XHR capture, web vitals, performance entries, compression payload transforms, and support ZIP export.
- Node syslog and worker transports, compression payload transforms, outgoing fetch/HTTP client capture, diagnostics_channel capture, and logger diagnostics.
- Node framework and data integrations: Express, Fastify, Koa, Nest, Hapi, Prisma, Redis, generic queues, BullMQ, serverless lifecycle, database method wrapping, and CLI capture.
- The `@loggerjs/processors` and `@loggerjs/codecs` catalogs. Individual processors and codecs are small and useful, but freezing about a hundred exports before real usage shows which ones matter would lock in the wrong ones.

Their import paths stay available within a major. Captured fields, hook coverage, and edge behavior may be refined after a deprecation, and real usage decides which of these components are promoted to Stable.

## Experimental

These packages are public because they are useful for integration testing and early adopters, but they have had the least production use:

| Package family | Experimental exports |
| --- | --- |
| Observability adapters | `@loggerjs/otel/*`, `@loggerjs/sentry/*` |
| Vendor wire transports | `@loggerjs/datadog/*`, `@loggerjs/elastic/*`, `@loggerjs/loki/*`, `@loggerjs/cloudwatch/*` |
| Database transports | `@loggerjs/database/*` |

Experimental does not mean untested. It means option names, payload mapping, retry expectations, batching guidance, or subpath layout may still change when design partners or live endpoints expose a better shape: after a deprecation in an earlier minor, or in a patch when a vendor endpoint changes and the old mapping stops working, which counts as a wire-protocol correctness fix.

Raw vendor transports are not durable by themselves. For production delivery, wrap them with `batchTransport()` and `retryTransport()` or use a collector endpoint that owns queueing, retry, authentication, and backoff.

## Contracts Beyond TypeScript Signatures

`api-reports/` only sees TypeScript declarations. These contracts are protected by tests instead:

- **Wire formats.** Codec output, the event shape the logger produces, and the exact HTTP requests the Node and browser transports send are pinned byte for byte by golden files under `packages/*/test/golden/`. Changing them is a wire-protocol change and follows the same policy as a signature change of the owning API.
- **Persisted browser data.** The IndexedDB schemas of `indexedDbTransport()` and `indexedDbBrowserHttpOfflineQueue()` must stay readable by the next release. `tests/e2e/browser-upgrade.spec.ts` writes data with the previous published release and reads it with the current code.
- **Shared process state.** With `configure({ shareAcrossCopies: true })`, every copy of `@loggerjs/core` loaded into one process (an ESM and a CJS build, or two installed versions) uses one registry, ambient context, and meta counters stored under `Symbol.for("@loggerjs/core/shared-state/v1")`; otherwise copies stay isolated. The copy that called `configure()` builds the registry's loggers, so its diagnostics sink sees them all. Subpath entries of one build always share state through shared chunks. The `v1` suffix changes only when the shape of that state changes incompatibly, which is a breaking change. Isolation stays the default for all of 1.x: a missing library log comes with a warning and a one-line fix, while sharing by default would let one micro-frontend's `configure()` replace another's and close its transports. Changing the default either way would be a breaking change.
- **Delivery accounting.** Every event handed to a first-party transport is delivered or reported through `onDrop` and the `transport.dropped.*` counters, and `flush()`/`close()` settle even when the destination fails. The one exception is events `browserHttpTransport()` hands to `navigator.sendBeacon()`: the browser never confirms them, so they are counted in `transport.beacon.accepted` instead. Failure-injection, model-based, and soak tests assert this invariant.

## Change Policy

The semantic-versioning guarantees of a package cover its Stable exports. The other tiers keep their own rules inside a 1.x package:

- **Stable:** no removals, renames, or signature breaks within a major. Removing a stable export takes a deprecation in a minor and the removal in the next major. Additive changes ship in minors: new options, fields, overloads, processors, transports, integrations, and subpaths. A behavior change outside security, data-loss, or wire-protocol correctness fixes needs a major, and those fixes are called out in the release notes.
- **Compatible:** a minor may change a compatible export only after an earlier minor has marked it `@deprecated` with a migration path, and the release notes must call the change out.
- **Experimental:** the Compatible rule applies: a breaking change needs a deprecation with a migration path in an earlier minor and a call-out in the release notes. Wire-protocol correctness fixes for a vendor endpoint are the exception, as they are for Stable exports.

In every tier, defaults that affect delivery, privacy, or performance change only with documentation and release notes, and public exports stay typechecked, tested, API-reported, and documented, because public does not mean disposable.

Moving the remaining compatible components into separate packages would remove the tiers inside `@loggerjs/browser` and `@loggerjs/node`; that stays an option for a later major.

## Package Versions

- `@loggerjs/core`, `@loggerjs/browser`, `@loggerjs/node`, and `@loggerjs/pretty` hold the stable kernel. They reached 1.0 together and form a Changesets `linked` group, so their version numbers move in step and nobody needs a compatibility table.
- The other packages (`@loggerjs/processors`, `@loggerjs/codecs`, the observability adapters, the vendor transports, and `@loggerjs/database`) reached 1.0.0 together with the kernel and release on their own schedule after that, so a processor, codec, or vendor adapter can take a minor or a major without moving the kernel. They are not in the linked group: Changesets computes a linked release from the highest version in the group, so one adapter's major would push core to the same major.
- Every package other than core declares `@loggerjs/core` as a peer dependency with `^1.0.0`, so an application installs exactly one core and the copy problem above only remains for genuinely separate bundles. Changesets runs with `onlyUpdatePeerDependentsWhenOutOfRange`, so a core release inside that range does not force a release of every package, and `pnpm pack:check` enforces the ranges.

## Adding Public API

New package exports must:

1. Add or update tests at the closest practical runtime level.
2. Update docs and examples for import boundaries and caveats.
3. Add the export to `docs/api-stability.policy.json`.
4. Run `pnpm verify:api-stability` and `pnpm api:check`.

Prefer examples and composition over new exports when an existing stable API can solve the use case.

## How to Evaluate a Future Upgrade

1. Read the package changelog and release notes.
2. Check this page and `api-stability.policy.json` for the export status you depend on.
3. Run `pnpm check` in this repository if you are contributing, or your application test suite if you are consuming LoggerJS.
4. For hot paths, reproduce your relevant benchmark with `pnpm bench:node` or `pnpm bench:browser`.
5. For remote delivery, test your actual collector/vendor endpoint and monitor `transport.dropped.*`, `transport.retry.*`, and queue-depth metrics.
