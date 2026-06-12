# @loggerjs/core

Core logger, record helpers, context, typed events, codecs, and platform-neutral transports.

```ts
import { consoleTransport, createLogger, defineEvent, withContext } from "@loggerjs/core";

const UserSignedIn = defineEvent<{ userId: string }>({
  type: "user.signed_in",
  message: (event) => `signed in ${event.userId}`,
});

const logger = createLogger({
  name: "app",
  level: "info",
  transports: [consoleTransport()],
});

withContext({ requestId: "req_123" }, () => {
  logger.event(UserSignedIn, { userId: "u_123" });
});
```

Subpaths include `@loggerjs/core/middleware`, `@loggerjs/core/codec-json`, `@loggerjs/core/codec-metrics`, `@loggerjs/core/payload-transforms`, `@loggerjs/core/transport-console`, `@loggerjs/core/transport-batch`, `@loggerjs/core/transport-reliability`, `@loggerjs/core/transport-test`, `@loggerjs/core/context`, `@loggerjs/core/trace-propagation`, `@loggerjs/core/events`, and `@loggerjs/core/semantic-events`.
