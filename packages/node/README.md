# @loggerjs/node

Node transports, process integrations, diagnostics-channel capture, and AsyncLocalStorage context.

```ts
import {
  captureProcessIntegration,
  createLogger,
  expressIntegration,
  fastifyIntegration,
  installAsyncLocalStorageContext,
  rotatingFileTransport,
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

```ts
const auditLogger = createLogger({
  name: "audit",
  transports: [rotatingFileTransport({ path: "audit.log", maxBytes: 10 * 1024 * 1024 })],
});
```

```ts
app.use(expressIntegration(logger, { captureAll: true }));
```

```ts
fastify.register(fastifyIntegration(logger, { captureAll: true }));
```

Subpaths expose `transport-http`, `transport-file`, `transport-rotating-file`, `transport-stdout`, `transport-worker`, `integration-process`, `integration-express`, `integration-fastify`, `integration-diagnostics`, and `context`.
