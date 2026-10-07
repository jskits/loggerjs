# API Stability

LoggerJS is still pre-1.0. The checked-in `api-reports/` files describe every exported TypeScript declaration, but they are not a promise that every exported symbol is already frozen for v1.

This page is the human contract. The machine-readable classification lives in [`docs/api-stability.policy.json`](https://github.com/jskits/loggerjs/blob/main/docs/api-stability.policy.json), and `pnpm verify:api-stability` fails when a package export is missing from that policy.

## Current Policy

Before v1, the project is narrowing the compatibility promise instead of freezing the whole repository. The stable set is intentionally limited to a kernel: the core logger model and pipeline contracts, the primary browser and Node delivery paths, the primary browser capture integrations, Node process capture and context, and pretty output. The v1 freeze should happen after design partners have run that kernel in production and the remaining surface has been pruned based on what they actually used, not before.

Everything else may still be public, tested, and useful, but it is not all part of the v1 compatibility promise yet. In particular, vendor, observability, and database packages remain experimental until they have more real-world usage and failure-mode validation.

## Status Levels

| Status | Meaning |
| --- | --- |
| Stable v1 Candidate | Intended to carry into v1 without removals, renames, or signature breaks except for security, data-loss, or wire-protocol correctness fixes. Additive changes are allowed. |
| Compatible Public Surface | Public and tested, but minor releases before v1 may refine option names, captured fields, or runtime edge behavior with release notes. |
| Experimental Before v1 | Public packages or subpaths that may change before v1. Use them when the current behavior fits, but do not treat them as frozen compatibility contracts. |

Internal source paths, `dist` file paths, generated bundle layout, private class fields, and behavior inferred only from tests are not public API in any status.

## Stable v1 Candidate

Stable exports are tracked in `api-stability.policy.json`. The current stable packages and entry families are:

| Package | Stable surface |
| --- | --- |
| `@loggerjs/core` | The root kernel (`createLogger`/`Logger`, `getLogger`/`configure`, levels, types, record and event conversion, ambient context, typed events, middleware, meta counters, error and safe-stringify utilities, JSON codecs, and the console, memory, batch, and reliability transports) and the `middleware`, `codec-json`, `context`, `events`, `transport-console`, `transport-batch`, and `transport-reliability` subpaths. |
| `@loggerjs/browser` | `transport-http`, `offline-indexeddb`, `transport-indexeddb`, `offline-first-transport`, and the console, error, context, and page-lifecycle integrations. |
| `@loggerjs/node` | `transport-stdout`, `transport-file`, `transport-rotating-file`, `transport-http`, `integration-process`, and AsyncLocalStorage `context`. |
| `@loggerjs/pretty` | Root package, formatter, console transport, and stream transports. |

Stable semantics include:

- `createLogger(options)`, `getLogger(category)`, and `configure(...)` for application and library-safe logging.
- Logger instance methods: `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `log`, `capture`, `event`, `child`, `withTags`, `withType`, `setLevel`, `getLevel`, `isEnabled`, `isLevelEnabled`, `addTransport`, `addProcessor`, `addIntegration`, `ready`, `flush`, `flushSync`, and `close`.
- Level names and numeric values: `trace=10`, `debug=20`, `info=30`, `warn=40`, `error=50`, `fatal=60`, and `silent`.
- The pipeline interfaces for `Middleware`, `Processor`, `Transport`, `Integration`, and `Codec`, including `TransportContext.toEvent(record)` memoized projection.
- Disabled levels return before record allocation and lazy message evaluation.
- Middleware, processors, codecs, integrations, and transports are error-isolated from application code.
- Serialization remains transport-owned; middleware and processors keep values structured.

## Compatible Public Surface

Compatible exports stay documented and tested, but they are not frozen enough to be stable v1 candidates yet. Current compatible areas include:

- Core modules that leave the root in 1.0: `@loggerjs/core/trace-propagation`, `semantic-events`, `payload-transforms`, `diagnostics`, `integration-api`, `event-route`, `codec-metrics`, `codec-prepared`, and `transport-test`. Their `@loggerjs/core` root re-exports are deprecated since 0.7 and removed in 1.0; import them from these subpaths. `pnpm verify:api-stability` only lets a root re-export less stable modules through deprecated specifiers.
- Browser and Node root packages (`@loggerjs/browser`, `@loggerjs/node`) are compatible convenience aggregators because they re-export both stable and compatible components. Since 0.7 their re-exports of compatible components are deprecated; in 1.0 the roots export only the core kernel and the stable browser or Node components and become stable. Import compatible components from their subpaths (see MIGRATION).
- Browser secondary transports and collectors: BroadcastChannel, service worker, WebSocket, framework errors, framework routers, generic router capture, ReportingObserver, runtime host, service worker messages, user actions, and WebSocket capture.
- Browser fetch/XHR capture, web vitals, performance entries, compression payload transforms, and support ZIP export.
- Node syslog and worker transports, compression payload transforms, outgoing fetch/HTTP client capture, diagnostics_channel capture, and logger diagnostics.
- Node framework and data integrations: Express, Fastify, Koa, Nest, Hapi, Prisma, Redis, generic queues, BullMQ, serverless lifecycle, database method wrapping, and CLI capture.
- The `@loggerjs/processors` and `@loggerjs/codecs` catalogs. Individual processors and codecs are small and useful, but freezing about a hundred exports before real usage shows which ones matter would lock in the wrong ones.

The public import paths should remain available during pre-v1, but exact captured fields, hook coverage, and edge behavior may be refined. These are the right places to tighten names or reduce claims before v1 if real usage shows the current API is too broad.

## Experimental Before v1

These packages are public because they are useful for integration testing and early adopters, but they are not v1 compatibility commitments yet:

| Package family | Experimental exports |
| --- | --- |
| Observability adapters | `@loggerjs/otel/*`, `@loggerjs/sentry/*` |
| Vendor wire transports | `@loggerjs/datadog/*`, `@loggerjs/elastic/*`, `@loggerjs/loki/*`, `@loggerjs/cloudwatch/*` |
| Database transports | `@loggerjs/database/*` |

Experimental does not mean untested. It means minor releases before v1 may change option names, payload mapping, retry expectations, batching guidance, or subpath layout if design partners or live endpoints expose a better shape.

Raw vendor transports are not durable by themselves. For production delivery, wrap them with `batchTransport()` and `retryTransport()` or use a collector endpoint that owns queueing, retry, authentication, and backoff.

## Contracts Beyond TypeScript Signatures

`api-reports/` only sees TypeScript declarations. These contracts are protected by tests instead:

- **Wire formats.** Codec output, the event shape the logger produces, and the exact HTTP requests the Node and browser transports send are pinned byte for byte by golden files under `packages/*/test/golden/`. Changing them is a wire-protocol change and follows the same policy as a signature change of the owning API.
- **Persisted browser data.** The IndexedDB schemas of `indexedDbTransport()` and `indexedDbBrowserHttpOfflineQueue()` must stay readable by the next release. `tests/e2e/browser-upgrade.spec.ts` writes data with the previous published release and reads it with the current code.
- **Shared process state.** With `configure({ shareAcrossCopies: true })`, every copy of `@loggerjs/core` loaded into one process (an ESM and a CJS build, or two installed versions) uses one registry, ambient context, and meta counters stored under `Symbol.for("@loggerjs/core/shared-state/v1")`; otherwise copies stay isolated. Subpath entries of one build always share state through shared chunks. The `v1` suffix changes only when the shape of that state changes incompatibly, which is a breaking change. Isolation stays the default for all of 1.x: a missing library log comes with a warning and a one-line fix, while sharing by default would let one micro-frontend's `configure()` replace another's and close its transports. Changing the default either way would be a breaking change.
- **Delivery accounting.** Every event handed to a first-party transport is delivered or reported through `onDrop` and the `transport.dropped.*` counters, and `flush()`/`close()` settle even when the destination fails. Failure-injection, model-based, and soak tests assert this invariant.

## Change Policy

For Stable v1 Candidate APIs:

- No intentional removals, renames, or signature breaks before v1 without a deprecation note and migration path.
- Additive changes are allowed: new options, fields, overloads, processors, transports, integrations, and subpaths.
- Defaults that affect delivery, privacy, or performance require documentation and release notes.
- Security fixes, data-loss fixes, and vendor wire-protocol correctness fixes may change edge-case behavior. Release notes must call those out.

For Compatible and Experimental APIs:

- Public exports stay typechecked, tested, API-reported, and documented.
- Minor releases may adjust names, options, field shape, or exact behavior before v1.
- Breaking changes should still include release notes and migration guidance, because public does not mean disposable.

## SemVer After 1.0

From 1.0, the semantic-versioning guarantees of a package cover its Stable exports. The other tiers keep their own rules inside a 1.x package:

- **Stable:** no removals, renames, or signature breaks within a major. Additive changes ship in minors. A behavior change outside security, data-loss, or wire-protocol correctness fixes needs a major.
- **Compatible:** a minor may change a compatible export only after an earlier minor has marked it `@deprecated` with a migration path, and the release notes must call the change out.
- **Experimental:** packages stay on 0.x until they are promoted, so their minors may change anything, with release notes.

Moving the remaining compatible components into separate packages would remove the tiers inside `@loggerjs/browser` and `@loggerjs/node`, but it costs too much before 1.0.

## Versioning at 1.0

- `@loggerjs/core`, `@loggerjs/browser`, `@loggerjs/node`, and `@loggerjs/pretty` hold the stable kernel. They move to 1.0 together and form a Changesets `linked` group, so their version numbers move in step and nobody needs a compatibility table.
- `@loggerjs/processors` and `@loggerjs/codecs` stay on 0.x until design-partner usage shows which processors and codecs to keep. Freezing their catalogs at 1.0 would promise stability nobody has validated.
- `@loggerjs/otel`, `@loggerjs/sentry`, `@loggerjs/datadog`, `@loggerjs/elastic`, `@loggerjs/loki`, `@loggerjs/cloudwatch`, and `@loggerjs/database` stay experimental on 0.x and release on their own schedule.
- Every package other than core declares `@loggerjs/core` as a peer dependency from 1.0, so an application installs exactly one core and the copy problem above only remains for genuinely separate bundles. Kernel packages use `^1.0.0`; the 0.x packages accept `^0.7.0 || ^1.0.0` so the move does not force them to 1.0.

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
