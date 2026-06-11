import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tempRoot = join(repoRoot, ".tmp", "verify-public-types");

const workspacePackages = {
  "@loggerjs/browser": "packages/browser",
  "@loggerjs/codecs": "packages/codecs",
  "@loggerjs/core": "packages/core",
  "@loggerjs/database": "packages/database",
  "@loggerjs/node": "packages/node",
  "@loggerjs/otel": "packages/otel",
  "@loggerjs/processors": "packages/processors",
  "@loggerjs/sentry": "packages/sentry",
  "@loggerjs/loki": "packages/loki",
  "@loggerjs/datadog": "packages/datadog",
  "@loggerjs/elastic": "packages/elastic",
  "@loggerjs/cloudwatch": "packages/cloudwatch",
};

const typeTestSource = `
import {
  createLogger,
  defineEvent,
  type EventDefinition,
  type EventLogOptions,
  type Transport,
} from "@loggerjs/core";
import { createMiddleware } from "@loggerjs/core/middleware";
import { jsonCodec } from "@loggerjs/core/codec-json";
import { consoleTransport } from "@loggerjs/core/transport-console";
import { testTransport } from "@loggerjs/core/transport-test";
import { browserBroadcastChannelTransport } from "@loggerjs/browser/transport-broadcast-channel";
import { browserHttpTransport } from "@loggerjs/browser/transport-http";
import { indexedDbTransport } from "@loggerjs/browser/transport-indexeddb";
import { exportLogsToZip } from "@loggerjs/browser/export-zip";
import { browserServiceWorkerTransport } from "@loggerjs/browser/transport-service-worker";
import { browserWebSocketTransport } from "@loggerjs/browser/transport-websocket";
import { captureFrameworkErrorsIntegration } from "@loggerjs/browser/integration-framework-errors";
import { capturePerformanceIntegration } from "@loggerjs/browser/integration-performance";
import { captureReportingIntegration } from "@loggerjs/browser/integration-reporting";
import { captureRouterIntegration } from "@loggerjs/browser/integration-router";
import { captureRuntimeHostIntegration } from "@loggerjs/browser/integration-runtime-host";
import { captureServiceWorkerIntegration } from "@loggerjs/browser/integration-service-worker";
import { captureUserActionsIntegration } from "@loggerjs/browser/integration-user-actions";
import { captureWebSocketIntegration } from "@loggerjs/browser/integration-websocket";
import { postgresTransport } from "@loggerjs/database/postgres";
import { sqliteTransport } from "@loggerjs/database/sqlite";
import { captureCliIntegration } from "@loggerjs/node/integration-cli";
import { databaseIntegration } from "@loggerjs/node/integration-database";
import { nodeFetchIntegration } from "@loggerjs/node/integration-fetch";
import { nodeHttpClientIntegration } from "@loggerjs/node/integration-http-client";
import { queueIntegration } from "@loggerjs/node/integration-queue";
import { serverlessIntegration } from "@loggerjs/node/integration-serverless";
import { nodeHttpTransport } from "@loggerjs/node/transport-http";
import { nodeSyslogTransport } from "@loggerjs/node/transport-syslog";
import { fastEventJsonCodec, msgpackrCodec, type MsgpackrCodecOptions } from "@loggerjs/codecs";
import { redact } from "@loggerjs/processors";
import { openTelemetryLogBridgeTransport } from "@loggerjs/otel/log-bridge";
import { openTelemetryTraceProcessor } from "@loggerjs/otel/trace";
import { sentryTransport, type SentryLike } from "@loggerjs/sentry/transport";
import { lokiTransport } from "@loggerjs/loki/transport";
import { datadogLogsTransport } from "@loggerjs/datadog/transport";
import { elasticTransport } from "@loggerjs/elastic/transport";
import { cloudWatchLogsTransport } from "@loggerjs/cloudwatch/transport";

type LoginPayload = { userId: string; attempts?: number };

const loginEvent = defineEvent<LoginPayload>({
  type: "auth.login",
  message: (payload) => payload.userId,
  tags: (payload) => ({ attempts: payload.attempts }),
});

const explicitDefinition: EventDefinition<LoginPayload> = loginEvent;
const explicitOptions: EventLogOptions<LoginPayload> = {
  message: (payload) => payload.userId,
};

const transport: Transport = consoleTransport();
const test = testTransport();
const logger = createLogger({ transports: [transport] });
await test.waitFor((event) => event.levelName === "info", { timeoutMs: 1 }).catch(() => {});
logger.event(explicitDefinition, { userId: "u1" }, explicitOptions);

// @ts-expect-error missing required event payload field
logger.event(loginEvent, {});

// @ts-expect-error wrong event payload field type
logger.event(loginEvent, { userId: 123 });

createMiddleware("identity", (record) => record);
jsonCodec().encode([]);
fastEventJsonCodec().encode([]);
const msgpackOptions: MsgpackrCodecOptions = { useRecords: true };
const msgpackPayload = msgpackrCodec(msgpackOptions).encode([]);
msgpackrCodec().decode?.(msgpackPayload);
redact({ paths: ["password"] });
browserBroadcastChannelTransport({
  channelName: "logs",
  channelFactory: () => ({ postMessage() {} }),
});
browserHttpTransport({ url: "/logs" });
const localStore = indexedDbTransport({ batchSize: 100, maxEntries: 1000 });
await exportLogsToZip(localStore, { source: "indexeddb" });
browserServiceWorkerTransport({
  serviceWorker: {
    controller: {
      postMessage() {},
    },
  },
});
browserWebSocketTransport({
  url: "wss://example.com/logs",
  webSocketFactory: () => ({
    readyState: 1,
    addEventListener() {},
    close() {},
    removeEventListener() {},
    send() {},
  }),
});
capturePerformanceIntegration({
  entryTypes: ["navigation", "resource", "longtask"],
  minDurationMs: { resource: 20 },
});
captureReportingIntegration({ reportTypes: ["csp-violation", "deprecation"] });
captureRouterIntegration({ includeState: true, urlMode: "path" });
captureRuntimeHostIntegration({ electronChannels: ["main:error"] });
captureServiceWorkerIntegration({ captureMessageData: false });
const frameworkErrors = captureFrameworkErrorsIntegration({ framework: "react" });
frameworkErrors.reactComponentDidCatch(new Error("boom"), { componentStack: "App" });
captureUserActionsIntegration({ events: ["click", "submit"], captureText: false });
captureWebSocketIntegration({ captureMessages: true, captureSentMessages: true });
captureCliIntegration({ captureEnv: ["NODE_ENV"] });
databaseIntegration({ client: { query: async () => ({}) }, minDurationMs: 100 });
nodeFetchIntegration({ captureResponseHeaders: ["x-trace-id"] });
nodeHttpClientIntegration({ captureRequestHeaders: ["x-request-id"] });
queueIntegration({ client: { send: async () => ({}) }, capturePayload: false });
serverlessIntegration(logger, async () => ({ ok: true }), { captureResult: true });
nodeHttpTransport({ url: "http://localhost:4318/v1/logs" });
sqliteTransport({
  database: {
    prepare: () => ({
      run() {},
    }),
  },
});
postgresTransport({
  client: {
    async query() {},
  },
});
nodeSyslogTransport({
  udpSocketFactory: () => ({
    send(_message, _port, _host, callback) {
      callback?.(undefined);
    },
  }),
});
openTelemetryLogBridgeTransport({ logger: { emit() {} } });
openTelemetryTraceProcessor();
sentryTransport({ sentry: {} satisfies SentryLike });
lokiTransport({ url: "http://localhost/loki", fetchFn: async () => new Response(null, { status: 204 }) });
datadogLogsTransport({ apiKey: "test", fetchFn: async () => new Response(null, { status: 202 }) });
elasticTransport({ url: "http://localhost:9200", fetchFn: async () => new Response(JSON.stringify({ errors: false }), { status: 200 }) });
cloudWatchLogsTransport({
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
  logGroupName: "group",
  logStreamName: "stream",
  region: "us-east-1",
  signer: async (request) => request.headers,
  fetchFn: async () => new Response("{}", { status: 200 }),
});
`;

const tsconfigSource = {
  compilerOptions: {
    exactOptionalPropertyTypes: false,
    lib: ["ES2022", "DOM"],
    module: "NodeNext",
    moduleResolution: "NodeNext",
    noEmit: true,
    preserveSymlinks: true,
    skipLibCheck: true,
    strict: true,
    target: "ES2022",
    types: ["node"],
  },
  include: ["index.ts"],
};

rmSync(tempRoot, { force: true, recursive: true });
mkdirSync(join(tempRoot, "node_modules", "@loggerjs"), { recursive: true });

for (const [packageName, packagePath] of Object.entries(workspacePackages)) {
  const linkName = packageName.replace("@loggerjs/", "");
  symlinkSync(
    join(repoRoot, packagePath),
    join(tempRoot, "node_modules", "@loggerjs", linkName),
    "dir",
  );
}

writeFileSync(join(tempRoot, "index.ts"), typeTestSource);
writeFileSync(join(tempRoot, "tsconfig.json"), `${JSON.stringify(tsconfigSource, null, 2)}\n`);

const tscBin = require.resolve("typescript/bin/tsc");
const result = spawnSync(process.execPath, [tscBin, "-p", join(tempRoot, "tsconfig.json")], {
  cwd: tempRoot,
  stdio: "inherit",
});

rmSync(tempRoot, { force: true, recursive: true });

if (result.status !== 0) {
  process.exitCode = result.status ?? 1;
} else {
  console.log("Verified public package type surface.");
}
