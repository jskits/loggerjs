# @loggerjs/otel

> OpenTelemetry mapping, OTLP/HTTP delivery, and an active-span trace processor for LoggerJS.

[![npm](https://img.shields.io/npm/v/@loggerjs/otel.svg)](https://www.npmjs.com/package/@loggerjs/otel)
[![license](https://img.shields.io/npm/l/@loggerjs/otel)](../../LICENSE)

OpenTelemetry integration for [LoggerJS](../../README.md). Ship logs to any OTLP endpoint over `fetch`, or bridge them into an existing OpenTelemetry `LoggerProvider`, and stamp every log with the active span's trace context.

## Install

```bash
npm install @loggerjs/otel
```

`@opentelemetry/api` (`>=1 <2`) is a **peer dependency** — pass the API object your app already uses.

## Usage

```ts
import { createLogger } from "@loggerjs/core";
import {
  openTelemetryLogBridgeTransport,
  openTelemetryTraceProcessor,
  otlpHttpTransport,
} from "@loggerjs/otel";

const logger = createLogger({
  category: ["api"],
  processors: [openTelemetryTraceProcessor({ api: otelApi })], // attach active-span trace_id/span_id
  transports: [
    otlpHttpTransport({
      url: "http://localhost:4318/v1/logs",
      resource: { "service.name": "checkout-api" },
      maxRecords: 100,
    }),
    // ...or bridge into an existing OpenTelemetry pipeline:
    openTelemetryLogBridgeTransport({ loggerProvider: logsProvider }),
  ],
});
```

## What's included

| Export | Purpose |
| --- | --- |
| `otlpHttpTransport` | OTLP/HTTP JSON log delivery over `fetch`, wrapped in `batchTransport` (batching + retry); set `resource`, `scopeName`, `scopeVersion`, `maxRecords`. |
| `openTelemetryLogBridgeTransport` | Emits into an existing OpenTelemetry `LoggerProvider` instead of speaking the wire protocol directly. |
| `openTelemetryTraceProcessor` | Reads the active span via `@opentelemetry/api` and stamps `trace_id` / `span_id` onto each event. |
| `otlpJsonCodec` | The OTLP JSON mapping as a standalone codec. |
| `toOtlpJson`, `toOtlpLogRecord`, `otelSeverityText`, `toOpenTelemetryLogBridgeRecord` | Low-level mapping helpers for custom pipelines. |

## Subpath exports

`@loggerjs/otel/transport-http` · `@loggerjs/otel/log-bridge` · `@loggerjs/otel/codec-otlp-json` · `@loggerjs/otel/trace`

## Documentation

- [Transports](../../docs/TRANSPORTS.md) — batch reliability options and vendor transport guidance
- [Concepts](../../docs/CONCEPTS.md) · [LoggerJS root README](../../README.md)

## License

[MIT](../../LICENSE) © JS Kits
