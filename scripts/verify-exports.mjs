import { mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packagesRoot = join(repoRoot, "packages");
const tempRoot = join(repoRoot, ".tmp", "verify-exports");

const expectedExportEntries = [
  ["@loggerjs/core", ["createLogger", "Logger"]],
  ["@loggerjs/core/middleware", ["createMiddleware"]],
  ["@loggerjs/core/codec-json", ["jsonCodec", "safeJsonCodec", "ndjsonCodec"]],
  ["@loggerjs/core/codec-metrics", ["metricsCodec"]],
  ["@loggerjs/core/transport-console", ["consoleTransport"]],
  ["@loggerjs/core/transport-batch", ["batchTransport", "estimateLogEventBytes"]],
  ["@loggerjs/core/transport-reliability", ["retryTransport", "fallbackTransport"]],
  ["@loggerjs/core/transport-test", ["testTransport"]],
  ["@loggerjs/codecs", ["fastEventJsonCodec", "msgpackrCodec", "projectorCodec"]],
  ["@loggerjs/core/context", ["withContext", "getContext"]],
  ["@loggerjs/core/trace-propagation", ["parseTraceparent", "formatTraceparent"]],
  ["@loggerjs/core/events", ["defineEvent"]],
  ["@loggerjs/core/semantic-events", ["semanticEvents"]],
  ["@loggerjs/core/payload-transforms", ["applyPayloadTransforms", "encryptionPayloadTransform"]],
  ["@loggerjs/browser", ["browserHttpTransport"]],
  ["@loggerjs/browser/transport-http", ["browserHttpTransport"]],
  ["@loggerjs/browser/payload-transforms", ["browserCompressionPayloadTransform"]],
  ["@loggerjs/browser/transport-broadcast-channel", ["browserBroadcastChannelTransport"]],
  ["@loggerjs/browser/transport-service-worker", ["browserServiceWorkerTransport"]],
  ["@loggerjs/browser/transport-websocket", ["browserWebSocketTransport"]],
  ["@loggerjs/browser/offline-indexeddb", ["indexedDbBrowserHttpOfflineQueue"]],
  ["@loggerjs/browser/transport-indexeddb", ["indexedDbTransport"]],
  ["@loggerjs/browser/offline-first-transport", ["offlineFirstTransport"]],
  ["@loggerjs/browser/export-zip", ["exportLogsToZip", "createLogZipBlob", "downloadBlob"]],
  ["@loggerjs/browser/integration-console", ["captureConsoleIntegration"]],
  ["@loggerjs/browser/integration-context", ["browserContextPropagationIntegration"]],
  ["@loggerjs/browser/integration-errors", ["captureBrowserErrorsIntegration"]],
  ["@loggerjs/browser/integration-fetch", ["captureFetchIntegration"]],
  ["@loggerjs/browser/integration-xhr", ["captureXHRIntegration"]],
  ["@loggerjs/browser/integration-framework-errors", ["captureFrameworkErrorsIntegration"]],
  [
    "@loggerjs/browser/integration-framework-routers",
    [
      "nextRouterIntegration",
      "reactRouterIntegration",
      "vueRouterIntegration",
      "nuxtRouterIntegration",
    ],
  ],
  ["@loggerjs/browser/integration-reporting", ["captureReportingIntegration"]],
  ["@loggerjs/browser/integration-router", ["captureRouterIntegration"]],
  ["@loggerjs/browser/integration-runtime-host", ["captureRuntimeHostIntegration"]],
  ["@loggerjs/browser/integration-service-worker", ["captureServiceWorkerIntegration"]],
  ["@loggerjs/browser/integration-user-actions", ["captureUserActionsIntegration"]],
  ["@loggerjs/browser/integration-websocket", ["captureWebSocketIntegration"]],
  ["@loggerjs/browser/integration-web-vitals", ["captureWebVitalsIntegration"]],
  ["@loggerjs/browser/integration-page-lifecycle", ["pageLifecycleIntegration"]],
  [
    "@loggerjs/browser/integration-performance",
    ["capturePerformanceIntegration", "normalizeBrowserPerformanceEntry"],
  ],
  ["@loggerjs/node", ["stdoutTransport"]],
  ["@loggerjs/node/transport-http", ["nodeHttpTransport"]],
  ["@loggerjs/node/payload-transforms", ["nodeCompressionPayloadTransform"]],
  ["@loggerjs/node/transport-file", ["fileTransport"]],
  ["@loggerjs/node/transport-rotating-file", ["rotatingFileTransport"]],
  ["@loggerjs/node/transport-stdout", ["stdoutTransport", "stderrTransport"]],
  ["@loggerjs/node/transport-syslog", ["nodeSyslogTransport", "formatSyslogMessage"]],
  ["@loggerjs/pretty", ["formatPrettyEvent", "prettyConsoleTransport", "prettyStreamTransport"]],
  ["@loggerjs/pretty/formatter", ["formatPrettyEvent"]],
  ["@loggerjs/pretty/transport-console", ["prettyConsoleTransport"]],
  [
    "@loggerjs/pretty/transport-stream",
    ["prettyStreamTransport", "prettyStdoutTransport", "prettyStderrTransport"],
  ],
  ["@loggerjs/database", ["databaseTransport", "sqliteTransport", "postgresTransport"]],
  ["@loggerjs/database/transport", ["databaseTransport", "createDatabaseLogRow"]],
  ["@loggerjs/database/sqlite", ["sqliteTransport", "createSQLiteDatabaseAdapter"]],
  ["@loggerjs/database/postgres", ["postgresTransport", "createPostgresDatabaseAdapter"]],
  ["@loggerjs/node/transport-worker", ["workerTransport"]],
  ["@loggerjs/node/integration-process", ["captureProcessIntegration"]],
  ["@loggerjs/node/integration-cli", ["captureCliIntegration"]],
  ["@loggerjs/node/integration-koa", ["koaIntegration"]],
  ["@loggerjs/node/integration-nest", ["nestMiddlewareIntegration"]],
  ["@loggerjs/node/integration-hapi", ["hapiIntegration"]],
  ["@loggerjs/node/integration-prisma", ["prismaIntegration"]],
  ["@loggerjs/node/integration-redis", ["redisIntegration"]],
  ["@loggerjs/node/integration-queue", ["queueIntegration"]],
  ["@loggerjs/node/integration-bullmq", ["bullMqIntegration"]],
  ["@loggerjs/node/integration-database", ["databaseIntegration"]],
  ["@loggerjs/node/integration-express", ["expressIntegration"]],
  ["@loggerjs/node/integration-fastify", ["fastifyIntegration"]],
  ["@loggerjs/node/integration-diagnostics", ["diagnosticsChannelIntegration"]],
  ["@loggerjs/node/logger-diagnostics", ["installLoggerDiagnosticsChannel"]],
  ["@loggerjs/node/integration-fetch", ["nodeFetchIntegration"]],
  ["@loggerjs/node/integration-http-client", ["nodeHttpClientIntegration"]],
  ["@loggerjs/node/integration-serverless", ["serverlessIntegration"]],
  [
    "@loggerjs/node/context",
    ["createAsyncLocalStorageContextManager", "installAsyncLocalStorageContext"],
  ],
  ["@loggerjs/otel", ["otlpHttpTransport"]],
  ["@loggerjs/otel/transport-http", ["otlpHttpTransport"]],
  ["@loggerjs/otel/codec-otlp-json", ["toOtlpJson", "otlpJsonCodec"]],
  ["@loggerjs/otel/trace", ["openTelemetryTraceProcessor"]],
  ["@loggerjs/otel/log-bridge", ["openTelemetryLogBridgeTransport"]],
  ["@loggerjs/sentry", ["sentryTransport"]],
  ["@loggerjs/sentry/transport", ["sentryTransport"]],
  ["@loggerjs/processors", ["redact", "privacyGuard", "normalizeError"]],
  ["@loggerjs/loki", ["lokiTransport"]],
  ["@loggerjs/loki/transport", ["lokiTransport"]],
  ["@loggerjs/datadog", ["datadogLogsTransport"]],
  ["@loggerjs/datadog/transport", ["datadogLogsTransport"]],
  ["@loggerjs/elastic", ["elasticTransport"]],
  ["@loggerjs/elastic/transport", ["elasticTransport", "createElasticBulkPayload"]],
  ["@loggerjs/cloudwatch", ["cloudWatchLogsTransport"]],
  [
    "@loggerjs/cloudwatch/transport",
    ["cloudWatchLogsTransport", "createCloudWatchPutLogEventsRequest", "signAwsV4Request"],
  ],
];

const expectedExports = new Map();
const failures = [];

function fail(message) {
  failures.push(message);
}

for (const [expectedSpecifier, names] of expectedExportEntries) {
  if (expectedExports.has(expectedSpecifier))
    fail(`${expectedSpecifier} has duplicate verifier expectations`);
  expectedExports.set(expectedSpecifier, names);
}

function packageEntries() {
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const packagePath = `packages/${entry.name}`;
      const packageJson = JSON.parse(
        readFileSync(join(repoRoot, packagePath, "package.json"), "utf8"),
      );
      return { packageName: packageJson.name, packagePath, exports: packageJson.exports ?? {} };
    })
    .toSorted((a, b) => a.packageName.localeCompare(b.packageName));
}

function packageSpecifier(packageName, exportPath) {
  return exportPath === "." ? packageName : `${packageName}${exportPath.slice(1)}`;
}

const packages = packageEntries();
const checks = [];
const actualSpecifiers = new Set();

for (const item of packages) {
  for (const exportPath of Object.keys(item.exports)) {
    const actualSpecifier = packageSpecifier(item.packageName, exportPath);
    actualSpecifiers.add(actualSpecifier);
    const expectedNames = expectedExports.get(actualSpecifier);
    if (!expectedNames) {
      fail(`${actualSpecifier} is exported but has no verifier expectations`);
      continue;
    }
    checks.push([actualSpecifier, expectedNames]);
  }
}

for (const expectedSpecifier of expectedExports.keys()) {
  if (!actualSpecifiers.has(expectedSpecifier))
    fail(`${expectedSpecifier} has verifier expectations but is not exported`);
}

if (failures.length > 0) {
  console.error("Export verification setup failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

const verifierSource = `
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const checks = ${JSON.stringify(checks, null, 2)};

function assertExports(specifier, namespace, expectedNames, loader) {
  for (const name of expectedNames) {
    if (!(name in namespace)) {
      throw new Error(\`\${loader} \${specifier} is missing \${name}\`);
    }
  }
}

for (const [specifier, expectedNames] of checks) {
  const imported = await import(specifier);
  assertExports(specifier, imported, expectedNames, "import");

  const required = require(specifier);
  assertExports(specifier, required, expectedNames, "require");
}
`;

rmSync(tempRoot, { force: true, recursive: true });
mkdirSync(join(tempRoot, "node_modules", "@loggerjs"), { recursive: true });

for (const { packageName, packagePath } of packages) {
  const linkName = packageName.replace("@loggerjs/", "");
  symlinkSync(
    join(repoRoot, packagePath),
    join(tempRoot, "node_modules", "@loggerjs", linkName),
    "dir",
  );
}

const verifierPath = join(tempRoot, "check.mjs");
writeFileSync(verifierPath, verifierSource);

try {
  await import(pathToFileURL(verifierPath).href);
  console.log(`Verified ${checks.length} package export entries.`);
} finally {
  rmSync(tempRoot, { force: true, recursive: true });
}
