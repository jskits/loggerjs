# Concepts

LoggerJS is organized around three user-facing concepts — **integrations**, **middleware/processors**, and **transports** — plus one boundary rule: **codecs belong to transports**. This page explains the pipeline that connects them.

## The Pipeline

```
logger.info("msg", data)
  │
  ├─ level gate            one numeric comparison; disabled levels stop here
  │
  ├─ LogRecord built       lazy message kept unevaluated, raw error kept,
  │                        category/type/tags/context attached
  │
  ├─ middleware            sync, ordered, can mutate or drop the record
  │
  ├─ processors?           if any processors exist, the record is projected
  │   │                    to a LogEvent (id assigned, message resolved,
  │   │                    error normalized) and processors run on the event
  │   │
  │   └─ no processors:    the record goes to transports directly
  │                        (the "record fast path" — no projection cost)
  │
  └─ transports            each transport receives the record (write/
      │                    writeBatch) or the event (log/logBatch);
      │                    conversion happens once and is shared
      │
      └─ codec             the transport serializes with its codec
```

Integrations sit outside this flow: they hook platform behavior (console calls, errors, fetch, process events) and feed captured input into the same pipeline through `api.capture()`.

## LogRecord vs LogEvent

`LogRecord` is the hot-path shape. It preserves raw values so no work happens before it is needed:

- `lazy` — an unevaluated message function, resolved at most once.
- `err` — the raw error value, not yet normalized.
- `props` — the user data object, shared by reference unless middleware,
  processors, or a transport explicitly clone it.
- `ctx` — a frozen bound context object, shared by reference.
- `tags` — possibly the logger's frozen tags object, shared by reference.
- No `id` — id computation is deferred to event projection.

`LogEvent` is the transport-facing compatibility shape: `id`, `time`, `seq`, `level`, `levelName`, `logger` (dotted category), `message` (resolved string), `type`, `tags`, `data`, `error` (normalized `SerializedError`), `context`, `trace`, `source`.

`recordToEvent()` / `eventToRecord()` convert between them. Conversion is lossy in documented ways: a `runtime` source collapses to an integration source, and scalar event data is wrapped as `{ value }`. Object data is not snapshotted by default; clone before logging when later mutation must not affect deferred transports.

### Mutation contract

Middleware may mutate a record, with one rule: **replace fields, never mutate shared objects in place**. `record.ctx` and logger-level `record.tags` are frozen and shared across records; write `record.tags = { ...record.tags, extra }`, not `record.tags.extra = ...`. In-place mutation of a frozen field throws and is reported as a middleware error without corrupting other records.

## Middleware vs Processors

Both are synchronous and error-isolated. They differ in what they see and when:

| | Middleware | Processor |
| --- | --- | --- |
| Input | `LogRecord` | `LogEvent` |
| Runs | before id/message/error work | after projection |
| Drop | return `null` | return `false` |
| Mutate | in place (replace fields) | return a new event |
| Cost of dropping | cheapest possible | projection already paid |

Prefer middleware for enrichment and early filtering. Use processors when you need the resolved event shape — routing by event fields, fingerprinting normalized errors, buffering events for fingers-crossed delivery.

**Configuring any processor disables the record fast path** for that logger, because every log must then be projected to an event. That is the correct trade when you need event-level behavior; see [PERFORMANCE.md](PERFORMANCE.md) for the numbers.

## Transports

A transport implements any of four methods:

```ts
interface Transport {
  name?: string;
  minLevel?: LoggerLevel;
  ready?(): void | Promise<void>;
  write?(record: LogRecord, context: TransportContext): void | Promise<void>;
  writeBatch?(records: LogRecord[], context: TransportContext): void | Promise<void>;
  log?(event: LogEvent, context: TransportContext): void | Promise<void>;
  logBatch?(events: LogEvent[], context: TransportContext): void | Promise<void>;
  flush?(): void | Promise<void>;
  flushSync?(): void;
  close?(): void | Promise<void>;
}
```

- Record-aware transports (`write`/`writeBatch`) participate in the fast path and may encode records directly.
- Event transports (`log`/`logBatch`) receive projected events.
- `context.toEvent(record)` converts on demand; the result is memoized per record, so several transports share one projection and ids stay stable across conversions.
- Errors thrown by a transport (sync or async) are caught and reported to logger meta; one failing transport never blocks the others.
- `ready()` is explicit and opt-in. Normal log calls do not wait for transport startup; callers that need startup confirmation call `logger.ready()`.
- `close()` must include its own best-effort flush before resource release. Core calls `close()` when it exists and falls back to `flush()` only when a transport has no `close()`.

## Codecs Belong to Transports

Serialization is owned by the transport, configured through its codec. Middleware and processors keep values raw — never pre-stringify in the pipeline. This keeps redaction working on structured data, lets each destination pick its own wire format, and lets batching amortize serialization.

```ts
stdoutTransport({ codec: ndjsonCodec() });
browserHttpTransport({ url: "/api/logs", codec: fastEventJsonCodec() });
```

See [CODECS.md](CODECS.md) for the contract and the fast-by-default safety semantics.

## Integrations

An integration is a named `setup(api)` function that hooks a platform surface and returns a teardown:

```ts
interface Integration {
  name: string;
  setup(api: IntegrationSetupContext): void | Teardown;
}
```

The setup context provides the logging API plus three safety tools:

- `api.capture(input)` — feed a captured signal into the pipeline, tagged with `source: "integration:<name>"`.
- `api.guard(fn)` — re-entrancy guard: if the patched code path ends up calling the logger, which calls the patched code again, the inner invocation is dropped and counted instead of looping forever.
- `api.unpatched` — a registry of original functions (`console.*`, `fetch`, `XMLHttpRequest`) so transports and integrations can call the real implementation under patching.

Integrations are installed at logger construction (or `addIntegration()`), set up exactly once per integration instance, and torn down in reverse order on `close()`.

## Routing

Processors can pin an event to named transports:

```ts
import { routeProcessor } from "@loggerjs/processors";

routeProcessor([{ minLevel: "error", transports: ["alerts"] }]);
```

Routes are attached as non-enumerable event metadata and consulted at dispatch. The record fast path performs no route filtering — routes can only be attached by processors, and the record path only runs when a logger has zero processors.

## Levels, Categories, Sources

- Levels are numbers (`trace` 10 … `fatal` 60) with names; custom numeric levels work everywhere.
- Categories are string arrays (`["api", "checkout"]`) joined to a dotted logger name in events; the registry routes configuration by category prefix.
- `source` distinguishes app logs from integration captures, so console capture can be excluded from console output and loops are detectable.

## Internal Errors and Meta Counters

The pipeline never throws into application code. Failures in middleware, processors, codecs, and transports are reported through `onInternalError` and counted in logger meta:

```ts
import { getLoggerMetaStats } from "@loggerjs/core";

getLoggerMetaStats();
// { "transport.errors": 1, "transport.dropped.queue-full": 2, "codec.fallback": 1, ... }
```

Use these counters to alert on silent degradation: queue drops, codec fallbacks, integration re-entrancy drops. `getLoggerSelfMetrics()` returns counters and gauges together, including queue depth and circuit-breaker state gauges exposed by shared transport helpers.

## Trace and Semantic Events

`trace-propagation` helpers parse/format W3C `traceparent` and baggage headers,
and `addContextProvider()` lets integrations attach ambient context without
replacing the app's context provider. `semanticEvents` defines common event
families (`error`, `http`, `db`, `job`, `ui`, `action`, `security`,
`performance`) so integrations and app logs can share field names.

## Further Reading

- [ARCHITECTURE.md](ARCHITECTURE.md) — the full design document, invariants, and decisions.
- [TRANSPORTS.md](TRANSPORTS.md), [INTEGRATIONS.md](INTEGRATIONS.md), [PROCESSORS.md](PROCESSORS.md), [CODECS.md](CODECS.md) — reference catalogs.
