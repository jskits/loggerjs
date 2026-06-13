# @loggerjs/processors

> The composable middleware and processor toolbox for LoggerJS — redact, sample, dedupe, rate-limit, fingerprint, enrich, route, and buffer.

[![npm](https://img.shields.io/npm/v/@loggerjs/processors.svg)](https://www.npmjs.com/package/@loggerjs/processors)
[![license](https://img.shields.io/npm/l/@loggerjs/processors)](../../LICENSE)

Synchronous, error-isolated steps that run inside the [LoggerJS](../../README.md) pipeline before delivery. **Middleware** run on the raw `LogRecord` (before id/message/error work); **processors** run on the projected `LogEvent`. Both are sandboxed — a throwing step is reported to logger meta and never corrupts other records or blocks delivery.

## Install

```bash
npm install @loggerjs/processors
```

## Usage

```ts
import { createLogger } from "@loggerjs/node";
import { redactProcessor, sampleProcessor, tagsMiddleware } from "@loggerjs/processors";

const logger = createLogger({
  category: ["api"],
  middleware: [tagsMiddleware({ service: "checkout" })],
  processors: [
    redactProcessor({ keys: ["password", "token", /secret/i] }),
    sampleProcessor({ rates: { debug: 0.1, info: 1, warn: 1, error: 1, fatal: 1 } }),
  ],
});
```

<details>
<summary>Full example — middleware and processors side by side</summary>

```ts
import {
  contextMiddleware, enrichMiddleware, tagsMiddleware, traceContextMiddleware, typeMiddleware,
  breadcrumbBufferProcessor, dedupeProcessor, dynamicSamplerProcessor, enrichProcessor,
  filterProcessor, fingerprintProcessor, fingersCrossedProcessor, levelOverrideProcessor,
  normalizeErrorProcessor, privacyGuardProcessor, rateLimitProcessor, redactProcessor,
  routeProcessor, sampleProcessor, schemaDevCheckProcessor, stackParserProcessor, tagsProcessor,
} from "@loggerjs/processors";

const middleware = [
  tagsMiddleware({ service: "checkout" }),
  typeMiddleware("order"),
  contextMiddleware({ region: "us-east-1" }),
  traceContextMiddleware(() => ({ traceId: "trace-id" })),
  enrichMiddleware({ data: { feature: "checkout" } }),
];

const processors = [
  redactProcessor({ keys: ["password", "token", /secret/i], censor: "[hidden]" }),
  privacyGuardProcessor({ maxStringLength: 8192, allowKeys: ["publicToken"] }),
  schemaDevCheckProcessor({
    validators: { "order.created": (data) => (typeof data === "object" && data ? true : "bad payload") },
  }),
  enrichProcessor({ tags: { service: "checkout" }, context: { region: "us-east-1" } }),
  normalizeErrorProcessor({ maxStackLines: 40, dataErrorKeys: ["failure"] }),
  stackParserProcessor({ dropInternal: true, includeRaw: false }),
  fingerprintProcessor({ parts: ["logger", "type", "message", "error.name", "error.message"] }),
  sampleProcessor({ rates: { debug: 0.1, info: 1, warn: 1, error: 1, fatal: 1, trace: 0.01 } }),
  dynamicSamplerProcessor({ defaultRate: 0.25, stickyBy: (event) => event.trace?.traceId }),
  tagsProcessor({ service: "checkout" }),
  levelOverrideProcessor([{ tags: { audit: true }, level: "warn" }]),
  filterProcessor([{ tags: { noisy: true }, reason: "noisy" }]),
  routeProcessor([{ tags: { audit: true }, transports: ["audit-store"] }]),
  dedupeProcessor(),
  rateLimitProcessor({ capacity: 100, refillPerSecond: 100 }),
  fingersCrossedProcessor({ triggerLevel: "error", bufferSize: 100 }),
  breadcrumbBufferProcessor({ bufferSize: 50, triggerLevel: "error" }),
];
```

</details>

## The toolbox

| Group | Steps |
| --- | --- |
| **Redaction & privacy** | `redactProcessor`, `privacyGuardProcessor` |
| **Sampling & volume** | `sampleProcessor`, `dynamicSamplerProcessor`, `rateLimitProcessor`, `dedupeProcessor`, `coalesceProcessor` |
| **Enrichment & tagging** | `enrichProcessor` / `enrichMiddleware`, `tagsProcessor` / `tagsMiddleware`, `typeProcessor` / `typeMiddleware`, `contextProcessor` / `contextMiddleware`, `traceContextProcessor` / `traceContextMiddleware` |
| **Errors** | `normalizeErrorProcessor`, `fingerprintProcessor`, `stackParserProcessor`, `symbolicateStackProcessor` |
| **Routing & control** | `routeProcessor`, `filterProcessor`, `levelOverrideProcessor` |
| **Buffering** | `fingersCrossedProcessor`, `breadcrumbBufferProcessor` |
| **Development** | `schemaDevCheckProcessor` |

## Ordering & cost

- **Prefer middleware** for metadata and enrichment that can run before event projection — it's the cheapest place to drop or annotate a record.
- **Use processors** for event-only behavior: routing, schema checks, sampling, buffering, and filtering on the resolved event shape.
- **Configuring any processor disables the record fast path** for that logger, because every log must then be projected to an event. That is the correct trade when you need event-level behavior — see [PROCESSORS.md](../../docs/PROCESSORS.md) and [PERFORMANCE.md](../../docs/PERFORMANCE.md).
- `redactProcessor()` supports exact `keys`/`paths`, regex/custom matchers, the Pino-compatible `censor` alias, and `remove: true` for omitting matched object fields. It does not compile user paths with `eval` or `new Function`.
- `fingersCrossedProcessor` accepts a `flushTo` transport or sink to replay buffered pre-trigger events. `routeProcessor` targets **named** transports, so name the transports you route to. Expensive I/O and serialization belong in transports, not processors.

## Documentation

- [Processors](../../docs/PROCESSORS.md) — the full reference and ordering guidance
- [Operations](../../docs/OPERATIONS.md) — privacy defaults and what to redact
- [Concepts](../../docs/CONCEPTS.md) · [LoggerJS root README](../../README.md)

## License

[MIT](../../LICENSE) © JS Kits
