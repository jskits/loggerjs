# @loggerjs/processors

Compatibility processor package for common synchronous middleware behavior.

```ts
import {
  dedupeProcessor,
  enrichProcessor,
  filterProcessor,
  fingersCrossedProcessor,
  levelOverrideProcessor,
  rateLimitProcessor,
  redactProcessor,
  routeProcessor,
  sampleProcessor,
  tagsProcessor,
} from "@loggerjs/processors";

const processors = [
  redactProcessor({ keys: ["password", "token", /secret/i] }),
  enrichProcessor({ tags: { service: "checkout" }, context: { region: "us-east-1" } }),
  sampleProcessor({ rates: { debug: 0.1, info: 1, warn: 1, error: 1, fatal: 1, trace: 0.01 } }),
  tagsProcessor({ service: "checkout" }),
  levelOverrideProcessor([{ tags: { audit: true }, level: "warn" }]),
  filterProcessor([{ tags: { noisy: true }, reason: "noisy" }]),
  routeProcessor([{ tags: { audit: true }, transports: ["audit-store"] }]),
  dedupeProcessor(),
  rateLimitProcessor({ capacity: 100, refillPerSecond: 100 }),
  fingersCrossedProcessor({ triggerLevel: "error", bufferSize: 100 }),
];
```

Processors are synchronous. Expensive I/O and serialization belong in transports. `fingersCrossedProcessor`
can receive a `flushTo` transport or sink when buffered pre-trigger events must be replayed.
`routeProcessor` targets transport names, so configure named transports when using per-event routing.
