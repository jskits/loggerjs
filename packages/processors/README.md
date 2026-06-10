# @loggerjs/processors

Compatibility processor package for common synchronous middleware behavior.

```ts
import {
  breadcrumbBufferProcessor,
  dedupeProcessor,
  dynamicSamplerProcessor,
  enrichProcessor,
  filterProcessor,
  fingerprintProcessor,
  fingersCrossedProcessor,
  levelOverrideProcessor,
  normalizeErrorProcessor,
  privacyGuardProcessor,
  rateLimitProcessor,
  redactProcessor,
  routeProcessor,
  sampleProcessor,
  schemaDevCheckProcessor,
  stackParserProcessor,
  tagsProcessor,
} from "@loggerjs/processors";

const processors = [
  redactProcessor({ keys: ["password", "token", /secret/i] }),
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

Processors are synchronous. Expensive I/O and serialization belong in transports. `fingersCrossedProcessor`
can receive a `flushTo` transport or sink when buffered pre-trigger events must be replayed.
`routeProcessor` targets transport names, so configure named transports when using per-event routing.
