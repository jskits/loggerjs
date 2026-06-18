import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packagesRoot = join(repoRoot, "packages");
const aggregateSubpathPackages = new Set([
  "@loggerjs/cloudwatch",
  "@loggerjs/datadog",
  "@loggerjs/elastic",
  "@loggerjs/loki",
  "@loggerjs/sentry",
]);
const failures = [];

function packageDirs() {
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
}

function outputStem(target) {
  return basename(target).replace(/\.(cjs|d\.ts|js)$/, "");
}

function isAggregateTarget(target) {
  return /\/index\.(cjs|d\.ts|js)$/.test(target);
}

function verifyExportCondition(packageDir, packageName, exportName, entries, condition, target) {
  if (typeof target !== "string") {
    failures.push(`${packageName} ${exportName} ${condition} is not a string target`);
    return;
  }
  if (
    exportName !== "." &&
    isAggregateTarget(target) &&
    !aggregateSubpathPackages.has(packageName)
  ) {
    failures.push(`${packageName} ${exportName} ${condition} points at the aggregate ${target}`);
  }
  if (!target.startsWith("./dist/")) return;
  const path = join(repoRoot, "packages", packageDir, target.slice(2));
  if (!existsSync(path)) {
    failures.push(`${packageName} ${exportName} ${condition} target is missing: ${target}`);
  }
  if (
    exportName !== "." &&
    (condition === "import" || condition === "require") &&
    !aggregateSubpathPackages.has(packageName)
  ) {
    const stem = outputStem(target);
    if (!(stem in entries)) {
      failures.push(
        `${packageName} ${exportName} ${condition} target ${target} has no loggerjsSubpathEntries entry`,
      );
    }
  }
}

for (const packageName of packageDirs()) {
  const packageJsonPath = join(repoRoot, "packages", packageName, "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const entries = packageJson.loggerjsSubpathEntries ?? {};
  const hasSubpathExports = Object.keys(packageJson.exports ?? {}).some((exportName) => {
    return exportName !== ".";
  });

  if (
    hasSubpathExports &&
    Object.keys(entries).length === 0 &&
    !aggregateSubpathPackages.has(packageJson.name)
  ) {
    failures.push(`${packageJson.name} has subpath exports but no loggerjsSubpathEntries`);
  }

  for (const [entryName, sourcePath] of Object.entries(entries)) {
    const absoluteSourcePath = join(repoRoot, "packages", packageName, sourcePath);
    if (!existsSync(absoluteSourcePath)) {
      failures.push(`${packageName} entry ${entryName} source is missing: ${sourcePath}`);
    }
  }

  for (const [exportName, target] of Object.entries(packageJson.exports ?? {})) {
    for (const condition of ["types", "import", "require"]) {
      verifyExportCondition(
        packageName,
        packageJson.name,
        exportName,
        entries,
        condition,
        target?.[condition],
      );
    }
  }
}

if (failures.length > 0) {
  console.error("Entry boundary verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Verified package subpath entry boundaries.");
