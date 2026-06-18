# API Stability

LoggerJS is still pre-1.0. The checked-in `api-reports/` files describe every
exported TypeScript declaration, but they are not a promise that every exported
symbol is already frozen for v1.

This page is the human contract. The machine-readable classification lives in
[`docs/api-stability.policy.json`](api-stability.policy.json), and
`pnpm verify:api-stability` fails when a package export is missing from that
policy.

## Current Policy

Before v1, the project is narrowing the compatibility promise instead of
freezing the whole repository. The stable set is intentionally limited to the
core logger model, core pipeline contracts, primary browser and Node delivery
paths, pretty output, processors, and codecs.

Everything else may still be public, tested, and useful, but it is not all part
of the v1 compatibility promise yet. In particular, vendor, observability, and
database packages remain experimental until they have more real-world usage and
failure-mode validation.

## Status Levels

| Status | Meaning |
| --- | --- |
| Stable v1 Candidate | Intended to carry into v1 without removals, renames, or signature breaks except for security, data-loss, or wire-protocol correctness fixes. Additive changes are allowed. |
| Compatible Public Surface | Public and tested, but minor releases before v1 may refine option names, captured fields, or runtime edge behavior with release notes. |
| Experimental Before v1 | Public packages or subpaths that may change before v1. Use them when the current behavior fits, but do not treat them as frozen compatibility contracts. |

Internal source paths, `dist` file paths, generated bundle layout, private class
fields, and behavior inferred only from tests are not public API in any status.

## Stable v1 Candidate

Stable exports are tracked in `api-stability.policy.json`. The current stable
packages and entry families are:

| Package | Stable surface |
| --- | --- |
| `@loggerjs/core` | Root package and documented core subpaths for middleware, codecs, events, context, trace propagation, payload transforms, and core transports. |
| `@loggerjs/browser` | Root package, HTTP delivery, IndexedDB/offline-first storage, payload transforms, and the primary console/error/fetch/XHR/context/performance/page-lifecycle integrations. |
| `@loggerjs/node` | Root package, stdout/stderr/file/rotating-file/HTTP/syslog/worker transports, payload transforms, process capture, outgoing HTTP capture, diagnostics, and AsyncLocalStorage context. |
| `@loggerjs/pretty` | Root package, formatter, console transport, and stream transports. |
| `@loggerjs/processors` | Root package processor and middleware catalog. |
| `@loggerjs/codecs` | Root package codec catalog. |

Stable semantics include:

- `createLogger(options)`, `getLogger(category)`, and `configure(...)` for
  application and library-safe logging.
- Logger instance methods: `trace`, `debug`, `info`, `warn`, `error`, `fatal`,
  `log`, `capture`, `event`, `child`, `withTags`, `withType`, `setLevel`,
  `getLevel`, `isEnabled`, `isLevelEnabled`, `addTransport`, `addProcessor`,
  `addIntegration`, `ready`, `flush`, `flushSync`, and `close`.
- Level names and numeric values: `trace=10`, `debug=20`, `info=30`,
  `warn=40`, `error=50`, `fatal=60`, and `silent`.
- The pipeline interfaces for `Middleware`, `Processor`, `Transport`,
  `Integration`, and `Codec`, including `TransportContext.toEvent(record)`
  memoized projection.
- Disabled levels return before record allocation and lazy message evaluation.
- Middleware, processors, codecs, integrations, and transports are
  error-isolated from application code.
- Serialization remains transport-owned; middleware and processors keep values
  structured.

## Compatible Public Surface

Compatible exports stay documented and tested, but they are not frozen enough to
be stable v1 candidates yet. Current compatible areas include:

- Browser secondary transports and collectors: BroadcastChannel, service
  worker, WebSocket, ZIP export, framework errors, framework routers, generic
  router capture, ReportingObserver, runtime host, service worker messages,
  user actions, and WebSocket capture.
- Node framework and data integrations: Express, Fastify, Koa, Nest, Hapi,
  Prisma, Redis, generic queues, BullMQ, serverless lifecycle, database method
  wrapping, and CLI capture.

The public import paths should remain available during pre-v1, but exact
captured fields, hook coverage, and edge behavior may be refined. These are the
right places to tighten names or reduce claims before v1 if real usage shows the
current API is too broad.

## Experimental Before v1

These packages are public because they are useful for integration testing and
early adopters, but they are not v1 compatibility commitments yet:

| Package family | Experimental exports |
| --- | --- |
| Observability adapters | `@loggerjs/otel/*`, `@loggerjs/sentry/*` |
| Vendor wire transports | `@loggerjs/datadog/*`, `@loggerjs/elastic/*`, `@loggerjs/loki/*`, `@loggerjs/cloudwatch/*` |
| Database transports | `@loggerjs/database/*` |

Experimental does not mean untested. It means minor releases before v1 may
change option names, payload mapping, retry expectations, batching guidance, or
subpath layout if design partners or live endpoints expose a better shape.

Raw vendor transports are not durable by themselves. For production delivery,
wrap them with `batchTransport()` and `retryTransport()` or use a collector
endpoint that owns queueing, retry, authentication, and backoff.

## Change Policy

For Stable v1 Candidate APIs:

- No intentional removals, renames, or signature breaks before v1 without a
  deprecation note and migration path.
- Additive changes are allowed: new options, fields, overloads, processors,
  transports, integrations, and subpaths.
- Defaults that affect delivery, privacy, or performance require documentation
  and release notes.
- Security fixes, data-loss fixes, and vendor wire-protocol correctness fixes
  may change edge-case behavior. Release notes must call those out.

For Compatible and Experimental APIs:

- Public exports stay typechecked, tested, API-reported, and documented.
- Minor releases may adjust names, options, field shape, or exact behavior
  before v1.
- Breaking changes should still include release notes and migration guidance,
  because public does not mean disposable.

## Adding Public API

New package exports must:

1. Add or update tests at the closest practical runtime level.
2. Update docs and examples for import boundaries and caveats.
3. Add the export to `docs/api-stability.policy.json`.
4. Run `pnpm verify:api-stability` and `pnpm api:check`.

Prefer examples and composition over new exports when an existing stable API can
solve the use case.

## How to Evaluate a Future Upgrade

1. Read the package changelog and release notes.
2. Check this page and `api-stability.policy.json` for the export status you
   depend on.
3. Run `pnpm check` in this repository if you are contributing, or your
   application test suite if you are consuming LoggerJS.
4. For hot paths, reproduce your relevant benchmark with `pnpm bench:node` or
   `pnpm bench:browser`.
5. For remote delivery, test your actual collector/vendor endpoint and monitor
   `transport.dropped.*`, `transport.retry.*`, and queue-depth metrics.
