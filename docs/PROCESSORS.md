# Processors and Middleware

`@loggerjs/processors` is the toolbox for the pipeline's middle layer. Everything here is synchronous, ordered, and error-isolated: a throwing processor is reported to logger meta and the pipeline continues.

Two flavors exist (see [CONCEPTS.md](CONCEPTS.md) for the full model):

- **Middleware** run on `LogRecord` before id/message/error work — cheapest place to enrich or drop.
- **Processors** run on `LogEvent` after projection — required when you need the resolved event shape.

Configuring any processor turns off the record fast path for that logger; middleware do not.

## Enrichment

| Export | What it does |
| --- | --- |
| `tagsProcessor(tags)` / `tagsMiddleware(tags)` | Merge fixed tags into every log. |
| `typeProcessor(type)` / `typeMiddleware(type)` | Set the event `type`. |
| `contextProcessor(ctx)` / `contextMiddleware(ctx)` | Merge fixed context fields. |
| `enrichProcessor(input)` / `enrichMiddleware(input)` | General patching: pass a static patch or a function returning `{ message, type, tags, data, context, trace, source }`; return `false` to drop. |
| `traceContextProcessor(provider)` / `traceContextMiddleware(provider)` | Attach `{ traceId, spanId, … }` from a provider function on every log. |

## Privacy and Normalization

| Export | What it does |
| --- | --- |
| `redactProcessor(options)` | Mask values by key name, path, or regex across data/context/tags. Copy-on-write so async transports never see half-redacted objects. |
| `privacyGuardProcessor(options)` | Blanket PII scrubbing with built-in patterns (emails, phone numbers, card-like digits) plus custom patterns. |
| `normalizeErrorProcessor(options)` | Force error shape: stack truncation, cause-chain depth limits, enumerable property capture. |
| `stackParserProcessor(options)` / `parseStack(stack)` | Parse stacks into structured frames (file, line, column, function). |
| `schemaDevCheckProcessor(options)` | Development-only event shape validation; flags drift between typed events and actual payloads. |

## Volume Control

| Export | What it does |
| --- | --- |
| `sampleProcessor(options)` | Probabilistic sampling with per-level rates; `error`/`fatal` are kept by default. |
| `dynamicSamplerProcessor(options)` | Adaptive sampling per category over a sliding window — throttles noisy loggers, leaves quiet ones alone. |
| `rateLimitProcessor(options)` | Token bucket per category; `error`/`fatal` exempt by default. |
| `dedupeProcessor(options)` | Fold repeated identical logs inside a time window into one event with a count. |
| `coalesceProcessor(options)` | Suppress repeated events in a window and emit the previous repeat count on the next matching event. |
| `fingerprintProcessor(options)` | Compute a stable fingerprint from configurable parts (`logger`, `error.name`, `stack.top`, custom functions) for grouping and dedupe keys. |
| `filterProcessor(input)` | Keep/drop by predicate or declarative rules (`minLevel`, `logger`, `type`, `tags`, integration source…). |
| `levelOverrideProcessor(input)` | Raise or clamp levels per category pattern (for example demote a chatty dependency). |

## Buffering and Routing

| Export | What it does |
| --- | --- |
| `fingersCrossedProcessor(options)` | Hold low-level logs in per-key ring buffers; when a trigger level fires, flush the buffered history to a target transport. The classic "give me the debug logs, but only when something breaks". |
| `breadcrumbBufferProcessor(options)` | Maintain a bounded breadcrumb trail and attach/replay it on triggering events. |
| `routeProcessor(input)` | Pin events to named transports or exclude transports, by rule (`[{ minLevel: "error", transports: ["alerts"] }]`). |
| `symbolicateStackProcessor(options)` | Hook source-map or release-service symbolication into parsed stack frames without bundling a source-map parser. |

## Ordering Guidance

Order matters; each stage sees the previous stage's output:

1. **Enrich first** (tags, context, trace) so later stages can match on the fields.
2. **Normalize** (errors, stacks) before anything that fingerprints or matches on error shape.
3. **Redact before sampling decisions that inspect data**, and always before anything leaves the process.
4. **Volume control last** (sample, rate-limit, dedupe) so you drop fully-formed events and your counters mean what they say.

```ts
createLogger({
  middleware: [tagsMiddleware({ service: "checkout" })],
  processors: [
    normalizeErrorProcessor(),
    redactProcessor({ keys: ["password", /token/i] }),
    sampleProcessor({ rates: { debug: 0.1 } }),
  ],
});
```

## Writing Your Own

Middleware:

```ts
import { createMiddleware } from "@loggerjs/core";

const requestIdMiddleware = createMiddleware("request-id", (record) => {
  record.props = { ...record.props, requestId: currentRequestId() };
  return record; // or null to drop
});
```

Processor:

```ts
import type { Processor } from "@loggerjs/core";

const dropHealthChecks: Processor = (event) => {
  if (event.data && (event.data as { path?: string }).path === "/healthz") return false;
  return event;
};
```

Contract reminders:

- Synchronous only — no `await` in the pipeline.
- Replace shared objects, never mutate them in place (`record.tags`, `record.ctx` may be frozen and shared).
- Throwing is reported and skipped; do not rely on a processor to always run.
