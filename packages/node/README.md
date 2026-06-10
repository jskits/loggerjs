# @loggerjs/node

Node transports, process integrations, diagnostics-channel capture, and AsyncLocalStorage context.

```ts
import {
  captureProcessIntegration,
  createLogger,
  installAsyncLocalStorageContext,
  stdoutTransport,
} from "@loggerjs/node";

installAsyncLocalStorageContext();

const logger = createLogger({
  name: "api",
  transports: [stdoutTransport()],
  integrations: [captureProcessIntegration()],
});

logger.info("server started", { port: 3000 });
await logger.flush();
```

Subpaths expose `transport-http`, `transport-file`, `transport-stdout`, `transport-worker`, `integration-process`, `integration-diagnostics`, and `context`.
