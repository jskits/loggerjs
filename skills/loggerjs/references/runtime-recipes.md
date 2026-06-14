# Runtime Recipes

Use these as starting points, then adjust names, tags, transports, and integrations to the target app.

## Node Service

```ts
import { captureProcessIntegration, createLogger, stdoutTransport } from "@loggerjs/node";
import { redactProcessor, tagsProcessor } from "@loggerjs/processors";

const logger = createLogger({
  name: "api",
  level: process.env.LOG_LEVEL ?? "info",
  tags: { service: "api", env: process.env.NODE_ENV ?? "dev" },
  processors: [redactProcessor(), tagsProcessor({ runtime: "node" })],
  transports: [stdoutTransport()],
  integrations: [captureProcessIntegration()],
});

logger.info("server started", { port: 3000 });
await logger.flush();
```

Use stdout first for container platforms that already collect process output. Add OTLP, Loki, Datadog, CloudWatch, or database transports only when the deployment needs direct delivery.

## Browser App

```ts
import {
  browserHttpTransport,
  captureBrowserErrorsIntegration,
  captureConsoleIntegration,
  captureFetchIntegration,
  createLogger,
  pageLifecycleIntegration,
} from "@loggerjs/browser";
import { redactProcessor, sampleProcessor } from "@loggerjs/processors";

export const logger = createLogger({
  name: "web",
  level: "info",
  tags: { app: "web" },
  processors: [
    redactProcessor(),
    sampleProcessor({ rates: { trace: 0.05, debug: 0.2, info: 1, warn: 1, error: 1, fatal: 1 } }),
  ],
  transports: [
    browserHttpTransport({
      url: "/api/logs",
      maxBatchSize: 20,
      flushIntervalMs: 1500,
      useBeaconOnPageHide: true,
    }),
  ],
  integrations: [
    captureConsoleIntegration({ levels: ["warn", "error"] }),
    captureBrowserErrorsIntegration(),
    captureFetchIntegration(),
    pageLifecycleIntegration(),
  ],
});
```

Use a server-owned ingestion endpoint for browser logs. Add IndexedDB/offline persistence when reload survival matters and the app can tolerate storage quota failures.

## Library

```ts
import { getLogger } from "@loggerjs/core";

const logger = getLogger(["my-library"]);

export function parseInput(value: unknown) {
  logger.debug("parse input", { valueType: typeof value });
}
```

Library code should not configure transports globally. Let the host app call `configure()` or create application loggers.

## Local Pretty Output

```ts
import { createLogger } from "@loggerjs/node";
import { prettyStdoutTransport } from "@loggerjs/pretty";

export const logger = createLogger({
  name: "dev",
  level: "debug",
  transports: [prettyStdoutTransport()],
});
```

Keep pretty output for local development. Production should still have structured delivery.

## OpenTelemetry Delivery

```ts
import { createLogger, stdoutTransport } from "@loggerjs/node";
import { openTelemetryTraceProcessor, otlpHttpTransport } from "@loggerjs/otel";

export const logger = createLogger({
  name: "api",
  processors: [openTelemetryTraceProcessor()],
  transports: [
    stdoutTransport(),
    otlpHttpTransport({
      url: process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ?? "http://localhost:4318/v1/logs",
      resource: { "service.name": "api" },
    }),
  ],
});
```

Use this when the app already has OpenTelemetry tracing or an OTLP collector.

## Sentry Delivery

```ts
import { createLogger } from "@loggerjs/core";
import { sentryTransport } from "@loggerjs/sentry";
import * as Sentry from "@sentry/node";

export const logger = createLogger({
  name: "api",
  transports: [sentryTransport({ sentry: Sentry, captureMessages: true })],
});
```

Use Sentry as an error/alerting path, not as the only high-volume structured-log sink unless the project has accepted that cost and retention model.
