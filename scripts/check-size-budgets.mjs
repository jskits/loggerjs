import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const budgets = [
  ["@loggerjs/core", "packages/core/dist/index.js", 88_000, 19_500],
  // Offline-queue replay on startup and after collector recovery measures 141,484 raw bytes.
  ["@loggerjs/browser", "packages/browser/dist/index.js", 142_000, 30_000],
  // Unhandled-rejection exit handling that honors --unhandled-rejections measures 75,230 raw bytes.
  ["@loggerjs/node", "packages/node/dist/index.js", 75_500, 15_600],
  ["@loggerjs/pretty", "packages/pretty/dist/index.js", 18_000, 5_000],
  ["@loggerjs/database", "packages/database/dist/index.js", 12_000, 4_000],
  ["@loggerjs/codecs", "packages/codecs/dist/index.js", 18_500, 4_400],
  // Scanning and redacting toJSON() values measures 55,856 raw and 13,006 gzip bytes.
  ["@loggerjs/processors", "packages/processors/dist/index.js", 56_500, 13_200],
  ["@loggerjs/otel", "packages/otel/dist/index.js", 10_000, 3_000],
  ["@loggerjs/sentry", "packages/sentry/dist/index.js", 4_000, 1_500],
  ["@loggerjs/loki", "packages/loki/dist/index.js", 8_000, 3_000],
  ["@loggerjs/datadog", "packages/datadog/dist/index.js", 8_000, 3_000],
  ["@loggerjs/elastic", "packages/elastic/dist/index.js", 8_000, 3_000],
  ["@loggerjs/cloudwatch", "packages/cloudwatch/dist/index.js", 12_000, 4_500],
];

const failures = [];
const rows = [];

for (const [name, relativePath, rawBudget, gzipBudget] of budgets) {
  const path = join(repoRoot, relativePath);
  if (!existsSync(path)) {
    failures.push(`${name}: missing ${relativePath}. Run pnpm build first.`);
    continue;
  }

  const rawSize = readFileSync(path).byteLength;
  const gzipSize = gzipSync(readFileSync(path)).byteLength;
  rows.push([name, rawSize, rawBudget, gzipSize, gzipBudget]);

  if (rawSize > rawBudget) {
    failures.push(`${name}: raw ${rawSize} bytes exceeds ${rawBudget} byte budget`);
  }
  if (gzipSize > gzipBudget) {
    failures.push(`${name}: gzip ${gzipSize} bytes exceeds ${gzipBudget} byte budget`);
  }
}

const nameWidth = Math.max(...rows.map(([name]) => name.length));
console.log("Package size budgets:");
for (const [name, rawSize, rawBudget, gzipSize, gzipBudget] of rows) {
  console.log(
    `${name.padEnd(nameWidth)} raw ${String(rawSize).padStart(6)}/${rawBudget} gzip ${String(gzipSize).padStart(5)}/${gzipBudget}`,
  );
}

if (failures.length > 0) {
  console.error("Size budget check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
