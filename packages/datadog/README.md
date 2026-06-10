# @loggerjs/datadog

Datadog Logs intake transport for loggerjs.

```ts
import { createLogger } from "@loggerjs/core";
import { datadogLogsTransport } from "@loggerjs/datadog";

const logger = createLogger({
  transports: [
    datadogLogsTransport({
      apiKey: process.env.DD_API_KEY,
      service: "checkout",
      source: "nodejs",
      tags: { env: "prod" },
    }),
  ],
});
```

The transport sends JSON arrays to Datadog Logs intake and preserves the structured
loggerjs event under the `loggerjs` field.
