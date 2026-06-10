# @loggerjs/elastic

Elasticsearch and Elastic Cloud `_bulk` transport for loggerjs.

```ts
import { createLogger } from "@loggerjs/core";
import { elasticTransport } from "@loggerjs/elastic";

const logger = createLogger({
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

Subpaths expose `transport`.
