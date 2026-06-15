import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packagesRoot = join(repoRoot, "packages");

const docsByKind = {
  integration: readFileSync(join(repoRoot, "docs", "INTEGRATIONS.md"), "utf8"),
  transport: readFileSync(join(repoRoot, "docs", "TRANSPORTS.md"), "utf8"),
};

const failures = [];

function packageJsonFiles() {
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(packagesRoot, entry.name, "package.json"));
}

function componentKind(exportName) {
  if (exportName.includes("integration")) return "integration";
  if (exportName.includes("transport")) return "transport";
  return undefined;
}

for (const packageJsonPath of packageJsonFiles()) {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

  for (const exportName of Object.keys(packageJson.exports ?? {})) {
    if (exportName === ".") continue;

    const kind = componentKind(exportName);
    if (!kind) continue;

    const specifier = `${packageJson.name}${exportName.slice(1)}`;
    if (!docsByKind[kind].includes(`\`${specifier}\``)) {
      failures.push(`${kind} export ${specifier} is missing from docs/${kind.toUpperCase()}S.md`);
    }
  }
}

if (failures.length > 0) {
  console.error("Component documentation verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Verified public transport/integration subpaths are documented.");
