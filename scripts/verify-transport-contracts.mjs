import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const docsPath = join(repoRoot, "docs", "TRANSPORT-CONTRACTS.md");

const rows = [
  {
    id: "core-batch",
    entries: ["@loggerjs/core/transport-batch"],
    sources: ["packages/core/src/transports/batch.ts"],
    tests: [
      "packages/core/test/batch-transport.test.ts",
      "packages/core/test/batch-coverage.test.ts",
    ],
  },
  {
    id: "core-retry",
    entries: ["@loggerjs/core/transport-reliability"],
    sources: ["packages/core/src/transports/reliability.ts"],
    tests: [
      "packages/core/test/reliability-transport.test.ts",
      "packages/core/test/reliability-coverage.test.ts",
    ],
  },
  {
    id: "core-console",
    entries: ["@loggerjs/core/transport-console"],
    sources: ["packages/core/src/transports/console.ts"],
    tests: ["packages/core/test/console-transport.test.ts"],
  },
  {
    id: "core-memory",
    entries: [],
    sources: ["packages/core/src/transports/memory.ts"],
    tests: ["packages/core/test/logger.test.ts", "packages/core/test/integration-api.test.ts"],
  },
  {
    id: "core-test",
    entries: ["@loggerjs/core/transport-test"],
    sources: ["packages/core/src/transports/test.ts"],
    tests: ["packages/core/test/test-transport.test.ts"],
  },
  {
    id: "browser-http",
    entries: ["@loggerjs/browser/transport-http"],
    sources: ["packages/browser/src/http-transport.ts"],
    tests: ["packages/browser/test/http-transport.test.ts", "tests/e2e/browser-production.spec.ts"],
  },
  {
    id: "browser-indexeddb-queue",
    entries: ["@loggerjs/browser/offline-indexeddb", "@loggerjs/browser/transport-indexeddb"],
    sources: [
      "packages/browser/src/indexeddb-offline-queue.ts",
      "packages/browser/src/indexeddb-transport.ts",
    ],
    tests: [
      "packages/browser/test/indexeddb-offline-queue.test.ts",
      "packages/browser/test/indexeddb-transport.test.ts",
      "tests/e2e/browser-production.spec.ts",
    ],
  },
  {
    id: "browser-offline-first",
    entries: ["@loggerjs/browser/offline-first-transport"],
    sources: ["packages/browser/src/offline-first-transport.ts"],
    tests: ["packages/browser/test/offline-first-transport.test.ts"],
  },
  {
    id: "browser-page-exit",
    entries: ["@loggerjs/browser/transport-http", "@loggerjs/browser/integration-page-lifecycle"],
    sources: ["packages/browser/src/http-transport.ts", "packages/browser/src/page-lifecycle.ts"],
    tests: [
      "packages/browser/test/http-transport.test.ts",
      "packages/browser/test/page-lifecycle.test.ts",
      "tests/e2e/browser-production.spec.ts",
    ],
  },
  {
    id: "browser-service-worker",
    entries: ["@loggerjs/browser/transport-service-worker"],
    sources: ["packages/browser/src/service-worker-transport.ts"],
    tests: [
      "packages/browser/test/service-worker-transport.test.ts",
      "tests/e2e/browser-production.spec.ts",
    ],
  },
  {
    id: "browser-websocket",
    entries: ["@loggerjs/browser/transport-websocket"],
    sources: ["packages/browser/src/websocket-transport.ts"],
    tests: ["packages/browser/test/websocket-transport.test.ts"],
  },
  {
    id: "browser-broadcast",
    entries: ["@loggerjs/browser/transport-broadcast-channel"],
    sources: ["packages/browser/src/broadcast-channel-transport.ts"],
    tests: ["packages/browser/test/broadcast-channel-transport.test.ts"],
  },
  {
    id: "node-http",
    entries: ["@loggerjs/node/transport-http"],
    sources: ["packages/node/src/http-transport.ts"],
    tests: ["packages/node/test/http-transport.test.ts"],
  },
  {
    id: "node-file",
    entries: ["@loggerjs/node/transport-file", "@loggerjs/node/transport-rotating-file"],
    sources: [
      "packages/node/src/file-transport.ts",
      "packages/node/src/rotating-file-transport.ts",
    ],
    tests: [
      "packages/node/test/file-transport.test.ts",
      "packages/node/test/rotating-file-transport.test.ts",
    ],
  },
  {
    id: "node-stdout",
    entries: ["@loggerjs/node/transport-stdout"],
    sources: ["packages/node/src/stdout-transport.ts"],
    tests: ["packages/node/test/stdout-transport.test.ts"],
  },
  {
    id: "node-syslog",
    entries: ["@loggerjs/node/transport-syslog"],
    sources: ["packages/node/src/syslog-transport.ts"],
    tests: ["packages/node/test/syslog-transport.test.ts"],
  },
  {
    id: "node-worker",
    entries: ["@loggerjs/node/transport-worker"],
    sources: ["packages/node/src/worker-transport.ts"],
    tests: ["packages/node/test/worker-transport.test.ts"],
  },
  {
    id: "database",
    entries: [
      "@loggerjs/database/transport",
      "@loggerjs/database/sqlite",
      "@loggerjs/database/postgres",
    ],
    sources: ["packages/database/src/index.ts"],
    tests: ["packages/database/test/database-transport.test.ts"],
  },
  {
    id: "datadog",
    entries: ["@loggerjs/datadog/transport"],
    sources: ["packages/datadog/src/index.ts"],
    tests: ["packages/datadog/test/datadog-transport.test.ts"],
  },
  {
    id: "elastic",
    entries: ["@loggerjs/elastic/transport"],
    sources: ["packages/elastic/src/index.ts"],
    tests: ["packages/elastic/test/elastic-transport.test.ts"],
  },
  {
    id: "loki",
    entries: ["@loggerjs/loki/transport"],
    sources: ["packages/loki/src/index.ts"],
    tests: ["packages/loki/test/loki-transport.test.ts"],
  },
  {
    id: "cloudwatch",
    entries: ["@loggerjs/cloudwatch/transport"],
    sources: ["packages/cloudwatch/src/index.ts"],
    tests: ["packages/cloudwatch/test/cloudwatch-transport.test.ts"],
  },
  {
    id: "sentry",
    entries: ["@loggerjs/sentry/transport"],
    sources: ["packages/sentry/src/index.ts"],
    tests: ["packages/sentry/test/sentry-transport.test.ts"],
  },
  {
    id: "otel-otlp",
    entries: ["@loggerjs/otel/transport-http", "@loggerjs/otel/codec-otlp-json"],
    sources: ["packages/otel/src/transport.ts", "packages/otel/src/otlp-json.ts"],
    tests: ["packages/otel/test/otlp-json.test.ts"],
  },
  {
    id: "pretty-console",
    entries: ["@loggerjs/pretty/transport-console"],
    sources: ["packages/pretty/src/console-transport.ts"],
    tests: ["packages/pretty/test/console-transport.test.ts"],
  },
  {
    id: "pretty-stream",
    entries: ["@loggerjs/pretty/transport-stream"],
    sources: ["packages/pretty/src/stream-transport.ts"],
    tests: ["packages/pretty/test/stream-transport.test.ts"],
  },
];

const failures = [];
const docs = readFileSync(docsPath, "utf8");
const expectedIds = new Set(rows.map((row) => row.id));
const documentedIds = new Set([...docs.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1]));

function fail(message) {
  failures.push(message);
}

function repoPathExists(path) {
  return existsSync(join(repoRoot, path));
}

function findMatrixRow(id) {
  return docs.split("\n").find((line) => line.startsWith(`| \`${id}\` |`));
}

function readJson(path) {
  return JSON.parse(readFileSync(join(repoRoot, path), "utf8"));
}

function packageJsonFiles() {
  return readdirSync(join(repoRoot, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `packages/${entry.name}/package.json`);
}

function requiresTransportContract(exportName) {
  return (
    exportName.includes("transport") ||
    exportName === "./offline-indexeddb" ||
    exportName === "./sqlite" ||
    exportName === "./postgres"
  );
}

function publicTransportEntries() {
  const entries = [];

  for (const packageJsonPath of packageJsonFiles()) {
    const packageJson = readJson(packageJsonPath);
    for (const exportName of Object.keys(packageJson.exports ?? {})) {
      if (exportName === "." || !requiresTransportContract(exportName)) continue;
      entries.push(`${packageJson.name}${exportName.slice(1)}`);
    }
  }

  return entries.toSorted();
}

function walk(dir) {
  const fullDir = join(repoRoot, dir);
  if (!existsSync(fullDir)) return [];

  return readdirSync(fullDir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return [path];
  });
}

function sourceFilesRequiringContract() {
  const candidates = [
    ...walk("packages/core/src/transports"),
    ...walk("packages/browser/src"),
    ...walk("packages/node/src"),
    ...walk("packages/pretty/src"),
    ...walk("packages/otel/src"),
  ];

  return candidates
    .filter((path) => path.endsWith(".ts"))
    .filter((path) => /(^|\/)([^/]*transport[^/]*|indexeddb-offline-queue)\.ts$/.test(path))
    .toSorted();
}

for (const id of expectedIds) {
  if (!documentedIds.has(id)) fail(`docs/TRANSPORT-CONTRACTS.md is missing matrix row ${id}`);
}

for (const id of documentedIds) {
  if (!expectedIds.has(id)) fail(`docs/TRANSPORT-CONTRACTS.md has unexpected matrix row ${id}`);
}

for (const row of rows) {
  const matrixRow = findMatrixRow(row.id);
  if (!matrixRow) continue;

  for (const entry of row.entries) {
    if (!matrixRow.includes(`\`${entry}\``)) {
      fail(`matrix row ${row.id} is missing public entry ${entry}`);
    }
  }

  for (const path of [...row.sources, ...row.tests]) {
    if (!repoPathExists(path)) fail(`matrix row ${row.id} references missing file ${path}`);
    if (!matrixRow.includes(path)) fail(`matrix row ${row.id} is missing file link ${path}`);
  }
}

const documentedEntries = new Set(rows.flatMap((row) => row.entries));
for (const entry of publicTransportEntries()) {
  if (!documentedEntries.has(entry)) fail(`public transport entry ${entry} is missing from matrix`);
}

const documentedSources = new Set(rows.flatMap((row) => row.sources));
for (const path of sourceFilesRequiringContract()) {
  if (!documentedSources.has(path)) fail(`transport source ${path} is missing from matrix`);
}

if (failures.length > 0) {
  console.error("Transport contract verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Verified ${rows.length} transport contract rows, ${publicTransportEntries().length} public entries, and ${sourceFilesRequiringContract().length} source files.`,
);
