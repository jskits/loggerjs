# @loggerjs/processors

Compatibility processor package for common synchronous middleware behavior.

```ts
import { dedupeProcessor, redactProcessor, sampleProcessor, tagsProcessor } from "@loggerjs/processors";

const processors = [
  redactProcessor({ keys: ["password", "token", /secret/i] }),
  sampleProcessor({ rates: { debug: 0.1, info: 1, warn: 1, error: 1, fatal: 1, trace: 0.01 } }),
  tagsProcessor({ service: "checkout" }),
  dedupeProcessor(),
];
```

Processors are synchronous. Expensive I/O and serialization belong in transports.
