import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { rolldown } from "rolldown";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const budgets = [
  // Retry-After handling (parseRetryAfter, httpStatusError, deferred batches) measures 101,185 raw and 22,314 gzip bytes with shared chunks.
  ["@loggerjs/core", "packages/core/dist/index.js", 101_800, 22_500],
  // Idempotency keys and resending held batches whole measure 150,638 raw and 31,414 gzip bytes with shared chunks.
  ["@loggerjs/browser", "packages/browser/dist/index.js", 151_100, 31_600],
  // Idempotency keys for nodeHttpTransport measure 81,800 raw and 16,285 gzip bytes with shared chunks.
  ["@loggerjs/node", "packages/node/dist/index.js", 82_300, 16_400],
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

// Tree-shaken, minified application bundles for the import paths most apps
// start with. Package-entry budgets above cannot see regressions here, because
// they measure every export whether or not an app imports it.
const minimalPaths = [
  // createLogger() plus consoleTransport() measures 19,500 raw and 6,303 gzip bytes.
  [
    "core logger + console",
    `import { createLogger } from "@loggerjs/core";
import { consoleTransport } from "@loggerjs/core/transport-console";
createLogger({ transports: [consoleTransport()] }).info("ready", { ok: true });`,
    19_900,
    6_400,
  ],
  // createLogger() plus browserHttpTransport() measures 25,258 raw and 8,494 gzip bytes.
  [
    "browser logger + http",
    `import { createLogger } from "@loggerjs/core";
import { browserHttpTransport } from "@loggerjs/browser/transport-http";
createLogger({ transports: [browserHttpTransport({ url: "/logs" })] }).info("ready");`,
    25_600,
    8_600,
  ],
  // createLogger() plus stdoutTransport() measures 21,065 raw and 6,872 gzip bytes.
  [
    "node logger + stdout",
    `import { createLogger } from "@loggerjs/core";
import { stdoutTransport } from "@loggerjs/node/transport-stdout";
createLogger({ transports: [stdoutTransport()] }).info("ready");`,
    21_500,
    7_000,
  ],
];

// Resolve @loggerjs/* imports through each package's exports map to its built
// ESM file, the way an application bundler would after installing it.
function resolveWorkspaceImport(id) {
  const match = /^@loggerjs\/([^/]+)(\/.*)?$/.exec(id);
  if (!match) return null;
  const packageDir = join(repoRoot, "packages", match[1]);
  const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  const target = manifest.exports?.[`.${match[2] ?? ""}`]?.import;
  if (!target) throw new Error(`${id} is not an exported entry`);
  return join(packageDir, target);
}

async function bundleMinimalPath(source) {
  const dir = mkdtempSync(join(tmpdir(), "loggerjs-size-"));
  try {
    const input = join(dir, "entry.mjs");
    writeFileSync(input, source);
    const bundle = await rolldown({
      input,
      platform: "neutral",
      external: (id) => id.startsWith("node:") || builtinModules.includes(id),
      plugins: [{ name: "loggerjs-workspace", resolveId: resolveWorkspaceImport }],
      treeshake: true,
    });
    const { output } = await bundle.generate({ format: "esm", minify: true });
    await bundle.close();
    return Buffer.from(output[0].code);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Package entries import shared chunks from dist/chunks/, so measure an entry
// together with every chunk it loads.
function entryWithChunks(entryPath) {
  const seen = new Set();
  const parts = [];
  const visit = (path) => {
    if (seen.has(path)) return;
    seen.add(path);
    const source = readFileSync(path);
    parts.push(source);
    const importPattern = /(?:\bfrom\s*|\bimport\s*)["'](\.{1,2}\/[^"']+)["']/g;
    for (const [, specifier] of source.toString("utf8").matchAll(importPattern)) {
      visit(join(dirname(path), specifier));
    }
  };
  visit(entryPath);
  return Buffer.concat(parts);
}

const failures = [];
const rows = [];

for (const [name, relativePath, rawBudget, gzipBudget] of budgets) {
  const path = join(repoRoot, relativePath);
  if (!existsSync(path)) {
    failures.push(`${name}: missing ${relativePath}. Run pnpm build first.`);
    continue;
  }

  const code = entryWithChunks(path);
  const rawSize = code.byteLength;
  const gzipSize = gzipSync(code).byteLength;
  rows.push([name, rawSize, rawBudget, gzipSize, gzipBudget]);

  if (rawSize > rawBudget) {
    failures.push(`${name}: raw ${rawSize} bytes exceeds ${rawBudget} byte budget`);
  }
  if (gzipSize > gzipBudget) {
    failures.push(`${name}: gzip ${gzipSize} bytes exceeds ${gzipBudget} byte budget`);
  }
}

const minimalBundles = await Promise.allSettled(
  minimalPaths.map(([, source]) => bundleMinimalPath(source)),
);
for (const [index, [name, , rawBudget, gzipBudget]] of minimalPaths.entries()) {
  const bundled = minimalBundles[index];
  if (bundled.status === "rejected") {
    failures.push(`${name}: bundling failed (${bundled.reason.message}). Run pnpm build first.`);
    continue;
  }
  const code = bundled.value;
  const rawSize = code.byteLength;
  const gzipSize = gzipSync(code).byteLength;
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
