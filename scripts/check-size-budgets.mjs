import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { rolldown } from "rolldown";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const budgets = [
  // Pending-write tracking, batch close cleanup, and registry snapshot replacement measure 88,391 raw bytes.
  ["@loggerjs/core", "packages/core/dist/index.js", 89_000, 19_800],
  // Offline-queue replay on startup and after collector recovery measures 141,484 raw bytes.
  ["@loggerjs/browser", "packages/browser/dist/index.js", 142_000, 30_000],
  // Rotation that survives failed renames and append-only reopening measure 75,621 raw bytes.
  ["@loggerjs/node", "packages/node/dist/index.js", 76_000, 15_600],
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
  // createLogger() plus consoleTransport() measures 21,331 raw and 6,301 gzip bytes.
  [
    "core logger + console",
    `import { createLogger } from "@loggerjs/core";
import { consoleTransport } from "@loggerjs/core/transport-console";
createLogger({ transports: [consoleTransport()] }).info("ready", { ok: true });`,
    21_800,
    6_400,
  ],
  // createLogger() plus browserHttpTransport() measures 23,365 raw and 7,685 gzip bytes.
  [
    "browser logger + http",
    `import { createLogger } from "@loggerjs/core";
import { browserHttpTransport } from "@loggerjs/browser/transport-http";
createLogger({ transports: [browserHttpTransport({ url: "/logs" })] }).info("ready");`,
    23_800,
    7_800,
  ],
  // createLogger() plus stdoutTransport() measures 20,489 raw and 6,609 gzip bytes.
  [
    "node logger + stdout",
    `import { createLogger } from "@loggerjs/core";
import { stdoutTransport } from "@loggerjs/node/transport-stdout";
createLogger({ transports: [stdoutTransport()] }).info("ready");`,
    20_900,
    6_700,
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
      external: (id) => id.startsWith("node:"),
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
