# @loggerjs/loki

> Push LoggerJS logs to Grafana Loki.

[![npm](https://img.shields.io/npm/v/@loggerjs/loki.svg)](https://www.npmjs.com/package/@loggerjs/loki)
[![license](https://img.shields.io/npm/l/@loggerjs/loki)](../../LICENSE)

A Grafana Loki push transport for [LoggerJS](../../README.md). It builds Loki JSON push payloads, groups events into streams by their labels, and POSTs them directly over `fetch` — no Loki client library required.

## Install

```bash
npm install @loggerjs/loki
```

## Usage

```ts
import { createLogger } from "@loggerjs/core";
import { lokiTransport } from "@loggerjs/loki";

const logger = createLogger({
  category: ["api"],
  transports: [
    lokiTransport({
      url: "https://loki.example.com/loki/api/v1/push",
      labels: { service: "checkout" }, // static stream labels
      labelTags: ["tenant"],           // promote these event tags to labels
    }),
  ],
});
```

## Options

| Option | Description |
| --- | --- |
| `url` | **Required.** Loki push endpoint. |
| `labels` | Static stream labels applied to every entry. |
| `labelTags` | Event tag keys promoted to stream labels (keep cardinality low). |
| `defaultLabels` | Include default labels such as level and logger name. |
| `structuredMetadata` | Attach event fields as Loki structured metadata. |
| `tenantId` | Sets the `X-Scope-OrgID` multi-tenancy header. |
| `line` | Function that renders the log line per event. |
| `headers`, `fetchFn` | Custom headers and `fetch` implementation. |

The transport supports `logBatch` delivery. For queueing, retry, backoff, or circuit-breaker behavior, wrap it with `batchTransport()` / `retryTransport()` from `@loggerjs/core` (see [TRANSPORTS.md](../../docs/TRANSPORTS.md)).

> **Label cardinality matters.** Loki indexes by label set — promote only low-cardinality tags to labels, and keep high-cardinality fields in the log line or structured metadata.

## Subpath exports

`@loggerjs/loki/transport`

## Documentation

- [Transports](../../docs/TRANSPORTS.md) · [LoggerJS root README](../../README.md)

## License

[MIT](../../LICENSE) © JS Kits
