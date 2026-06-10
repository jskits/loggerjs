# @loggerjs/otel

OpenTelemetry helpers for LoggerJS.

```ts
import { createLogger } from "@loggerjs/core";
import { openTelemetryTraceProcessor, otlpHttpTransport } from "@loggerjs/otel";

const logger = createLogger({
  name: "api",
  processors: [openTelemetryTraceProcessor({ api: otelApi })],
  transports: [
    otlpHttpTransport({
      url: "http://localhost:4318/v1/logs",
      resource: { "service.name": "checkout-api" },
      maxRecords: 100,
    }),
  ],
});
```

Subpaths expose `transport-http`, `codec-otlp-json`, and `trace`.
