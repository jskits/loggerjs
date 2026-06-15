import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packages = ["browser", "node"];
const failures = [];

function verifyExportCondition(packageName, exportName, condition, target) {
  if (typeof target !== "string") {
    failures.push(`${packageName} ${exportName} ${condition} is not a string target`);
    return;
  }
  if (exportName !== "." && /\/index\.(cjs|d\.ts|js)$/.test(target)) {
    failures.push(`${packageName} ${exportName} ${condition} points at the aggregate ${target}`);
  }
  if (!target.startsWith("./dist/")) return;
  const path = join(repoRoot, "packages", packageName, target.slice(2));
  if (!existsSync(path)) {
    failures.push(`${packageName} ${exportName} ${condition} target is missing: ${target}`);
  }
}

for (const packageName of packages) {
  const packageJsonPath = join(repoRoot, "packages", packageName, "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const entries = packageJson.loggerjsSubpathEntries ?? {};

  for (const [entryName, sourcePath] of Object.entries(entries)) {
    const absoluteSourcePath = join(repoRoot, "packages", packageName, sourcePath);
    if (!existsSync(absoluteSourcePath)) {
      failures.push(`${packageName} entry ${entryName} source is missing: ${sourcePath}`);
    }
  }

  for (const [exportName, target] of Object.entries(packageJson.exports ?? {})) {
    for (const condition of ["types", "import", "require"]) {
      verifyExportCondition(packageName, exportName, condition, target?.[condition]);
    }
  }
}

if (failures.length > 0) {
  console.error("Entry boundary verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Verified browser/node subpath entry boundaries.");
