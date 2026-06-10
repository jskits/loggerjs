# @loggerjs/sentry

Sentry adapter transport for structured logs, breadcrumbs, and exception/message capture.

```ts
import { createLogger } from "@loggerjs/core";
import { sentryTransport } from "@loggerjs/sentry";

const logger = createLogger({
  name: "web",
  transports: [
    sentryTransport({
      sentry: Sentry,
      breadcrumbs: true,
      structuredLogs: true,
      captureErrors: true,
    }),
  ],
});
```

`@sentry/core` is an optional peer dependency. Pass the Sentry object used by your application.
