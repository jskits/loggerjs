# @loggerjs/elastic

> Index LoggerJS logs into Elasticsearch or Elastic Cloud via the `_bulk` API.

[![npm](https://img.shields.io/npm/v/@loggerjs/elastic.svg)](https://www.npmjs.com/package/@loggerjs/elastic)
[![license](https://img.shields.io/npm/l/@loggerjs/elastic)](../../LICENSE)

An Elasticsearch bulk transport for [LoggerJS](../../README.md). It builds `_bulk` payloads and POSTs them directly over `fetch` — no `@elastic/elasticsearch` SDK required.

## Install

```bash
npm install @loggerjs/elastic
```

## Usage

```ts
import { createLogger } from "@loggerjs/core";
import { elasticTransport } from "@loggerjs/elastic";

const logger = createLogger({
  category: ["api"],
  transports: [
    elasticTransport({
      url: "https://elastic.example.com",
      index: "loggerjs-logs",
      apiKey: process.env.ELASTIC_API_KEY,
    }),
  ],
});

logger.info("indexed");
```

## Options

| Option | Description |
| --- | --- |
| `url` | **Required.** Elasticsearch base URL. |
| `index` | Target index — a fixed string or a function of the event (e.g. date-based indices). |
| `apiKey` | Base64 API key for the `Authorization: ApiKey` header. |
| `opType` | Bulk op type (`index` or `create`). |
| `pipeline` | Ingest pipeline name, or a function returning one per event. |
| `id` | Function returning a document `_id` per event (omit for auto-ids). |
| `refresh` | `true`, `false`, or `"wait_for"`. |
| `checkBulkErrors` | Inspect the bulk response and report per-item failures to logger meta. |
| `document` | Map an event to the indexed document shape. |
| `headers`, `fetchFn` | Custom headers and `fetch` implementation. |

The transport supports `logBatch` delivery. For queueing, retry, backoff, or circuit-breaker behavior, wrap it with `batchTransport()` / `retryTransport()` from `@loggerjs/core` (see [TRANSPORTS.md](../../docs/TRANSPORTS.md)). The helpers `createElasticBulkPayload` and `toElasticDocument` are exported for custom pipelines.

## Subpath exports

`@loggerjs/elastic/transport`

## Documentation

- [Transports](../../docs/TRANSPORTS.md) · [LoggerJS root README](../../README.md)

## License

[MIT](../../LICENSE) © JS Kits
