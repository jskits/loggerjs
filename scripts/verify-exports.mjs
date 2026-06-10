import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tempRoot = join(repoRoot, ".tmp", "verify-exports");

const checks = [
  ["@loggerjs/core", ["createLogger", "Logger"]],
  ["@loggerjs/core/middleware", ["createMiddleware"]],
  ["@loggerjs/core/codec-json", ["jsonCodec", "safeJsonCodec", "ndjsonCodec"]],
  ["@loggerjs/core/transport-console", ["consoleTransport"]],
  ["@loggerjs/core/transport-batch", ["batchTransport", "estimateLogEventBytes"]],
  ["@loggerjs/core/transport-test", ["testTransport"]],
  ["@loggerjs/core/context", ["withContext", "getContext"]],
  ["@loggerjs/core/events", ["defineEvent"]],
  ["@loggerjs/browser", ["browserHttpTransport"]],
  ["@loggerjs/browser/transport-http", ["browserHttpTransport"]],
  ["@loggerjs/browser/transport-broadcast-channel", ["browserBroadcastChannelTransport"]],
  ["@loggerjs/browser/transport-websocket", ["browserWebSocketTransport"]],
  ["@loggerjs/browser/integration-console", ["captureConsoleIntegration"]],
  ["@loggerjs/browser/integration-errors", ["captureBrowserErrorsIntegration"]],
  ["@loggerjs/browser/integration-fetch", ["captureFetchIntegration"]],
  ["@loggerjs/browser/integration-xhr", ["captureXHRIntegration"]],
  ["@loggerjs/browser/integration-page-lifecycle", ["pageLifecycleIntegration"]],
  ["@loggerjs/node", ["stdoutTransport"]],
  ["@loggerjs/node/transport-http", ["nodeHttpTransport"]],
  ["@loggerjs/node/transport-file", ["fileTransport"]],
  ["@loggerjs/node/transport-stdout", ["stdoutTransport", "stderrTransport"]],
  ["@loggerjs/node/transport-worker", ["workerTransport"]],
  ["@loggerjs/node/integration-process", ["captureProcessIntegration"]],
  ["@loggerjs/node/integration-diagnostics", ["diagnosticsChannelIntegration"]],
  [
    "@loggerjs/node/context",
    ["createAsyncLocalStorageContextManager", "installAsyncLocalStorageContext"],
  ],
  ["@loggerjs/otel", ["otlpHttpTransport"]],
  ["@loggerjs/otel/transport-http", ["otlpHttpTransport"]],
  ["@loggerjs/otel/codec-otlp-json", ["toOtlpJson", "otlpJsonCodec"]],
  ["@loggerjs/otel/trace", ["openTelemetryTraceProcessor"]],
  ["@loggerjs/sentry", ["sentryTransport"]],
  ["@loggerjs/sentry/transport", ["sentryTransport"]],
  ["@loggerjs/loki", ["lokiTransport"]],
  ["@loggerjs/loki/transport", ["lokiTransport"]],
  ["@loggerjs/datadog", ["datadogLogsTransport"]],
  ["@loggerjs/datadog/transport", ["datadogLogsTransport"]],
];

const workspacePackages = {
  "@loggerjs/browser": "packages/browser",
  "@loggerjs/core": "packages/core",
  "@loggerjs/node": "packages/node",
  "@loggerjs/otel": "packages/otel",
  "@loggerjs/sentry": "packages/sentry",
  "@loggerjs/loki": "packages/loki",
  "@loggerjs/datadog": "packages/datadog",
};

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

for (const [packageName, packagePath] of Object.entries(workspacePackages)) {
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
