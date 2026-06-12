# @loggerjs/node

Node transports, process integrations, diagnostics-channel capture, and AsyncLocalStorage context.

```ts
import {
  captureProcessIntegration,
  createLogger,
  expressIntegration,
  fastifyIntegration,
  installAsyncLocalStorageContext,
  nodeCompressionPayloadTransform,
  nodeFetchIntegration,
  nodeHttpTransport,
  nodeHttpClientIntegration,
  nodeSyslogTransport,
  rotatingFileTransport,
  stdoutTransport,
} from "@loggerjs/node";

installAsyncLocalStorageContext();

const logger = createLogger({
  name: "api",
  transports: [
    stdoutTransport(),
    nodeHttpTransport({
      url: "https://collector.example/logs",
      transformPayload: nodeCompressionPayloadTransform({ format: "brotli" }),
    }),
  ],
  integrations: [captureProcessIntegration(), nodeHttpClientIntegration(), nodeFetchIntegration()],
});

logger.info("server started", { port: 3000 });
await logger.flush();
```

```ts
const infraLogger = createLogger({
  name: "infra",
  transports: [nodeSyslogTransport({ host: "127.0.0.1", port: 514, facility: 16 })],
});
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

Subpaths expose `transport-http`, `payload-transforms`, `transport-file`, `transport-rotating-file`, `transport-stdout`, `transport-syslog`, `transport-worker`, `integration-process`, `integration-cli`, `integration-koa`, `integration-nest`, `integration-hapi`, `integration-prisma`, `integration-redis`, `integration-queue`, `integration-bullmq`, `integration-serverless`, `integration-database`, `integration-express`, `integration-fastify`, `integration-fetch`, `integration-http-client`, `integration-diagnostics`, and `context`.
