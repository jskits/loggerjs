# @loggerjs/loki

Grafana Loki push transport for loggerjs.

```ts
import { createLogger } from "@loggerjs/core";
import { lokiTransport } from "@loggerjs/loki";

const logger = createLogger({
  transports: [
    lokiTransport({
      url: "https://loki.example.com/loki/api/v1/push",
      labels: { service: "checkout" },
      labelTags: ["tenant"],
    }),
  ],
});
```

The transport sends Loki JSON push payloads and groups events by stream labels.
