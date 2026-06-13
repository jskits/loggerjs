# @loggerjs/datadog

> Ship LoggerJS logs to the Datadog Logs intake API.

[![npm](https://img.shields.io/npm/v/@loggerjs/datadog.svg)](https://www.npmjs.com/package/@loggerjs/datadog)
[![license](https://img.shields.io/npm/l/@loggerjs/datadog)](../../LICENSE)

A Datadog Logs transport for [LoggerJS](../../README.md). It speaks the intake API directly over `fetch` — no `datadog-api-client` SDK — and preserves the full structured LoggerJS event under the `loggerjs` field.

## Install

```bash
npm install @loggerjs/datadog
```

## Usage

```ts
import { createLogger } from "@loggerjs/core";
import { datadogLogsTransport } from "@loggerjs/datadog";

const logger = createLogger({
  category: ["api"],
  transports: [
    datadogLogsTransport({
      apiKey: process.env.DD_API_KEY,
      site: "datadoghq.com", // or datadoghq.eu, us3.datadoghq.com, …
      service: "checkout",
      source: "nodejs",
      tags: { env: "prod" },
    }),
  ],
});

logger.info("order created", { orderId: "ord_123" });
```

## Options

| Option | Description |
| --- | --- |
| `apiKey` | Datadog API key (or set `url` to a proxy that injects it). |
| `site` | Datadog site, e.g. `datadoghq.com` / `datadoghq.eu`. |
| `service`, `source`, `hostname` | Reserved Datadog attributes stamped on every log. |
| `tags` | Global tags as an object or `key:value` string array. |
| `eventTagKeys` | Event tag keys to promote into Datadog `ddtags`. |
| `message`, `status` | Functions to derive the log message and status from an event. |
| `headers`, `url`, `fetchFn` | Custom headers, endpoint override, and `fetch` implementation. |

The transport supports `logBatch` delivery. For queueing, retry, backoff, or circuit-breaker behavior, wrap it with `batchTransport()` / `retryTransport()` from `@loggerjs/core` (see [TRANSPORTS.md](../../docs/TRANSPORTS.md)).

## Subpath exports

`@loggerjs/datadog/transport`

## Documentation

- [Transports](../../docs/TRANSPORTS.md) · [LoggerJS root README](../../README.md)

## License

[MIT](../../LICENSE) © JS Kits
