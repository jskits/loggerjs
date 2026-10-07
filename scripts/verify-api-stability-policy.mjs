import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packagesRoot = join(repoRoot, "packages");
const policyPath = join(repoRoot, "docs", "api-stability.policy.json");
const docsPath = join(repoRoot, "docs", "API-STABILITY.md");
const statuses = ["stable", "compatible", "experimental"];
const statusRank = new Map(statuses.map((status, index) => [status, index]));

const policy = JSON.parse(readFileSync(policyPath, "utf8"));
const docs = readFileSync(docsPath, "utf8");
const failures = [];
const actualExports = new Map();

function addFailure(message) {
  failures.push(message);
}

function specifier(packageName, exportPath) {
  return exportPath === "." ? packageName : `${packageName}${exportPath.slice(1)}`;
}

for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const packageJsonPath = join(packagesRoot, entry.name, "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  for (const exportPath of Object.keys(packageJson.exports ?? {})) {
    actualExports.set(`${packageJson.name}:${exportPath}`, {
      packageName: packageJson.name,
      exportPath,
      specifier: specifier(packageJson.name, exportPath),
      packageJsonPath,
    });
  }
}

const classifiedExports = new Map();

for (const status of statuses) {
  const packages = policy[status];
  if (!packages || typeof packages !== "object" || Array.isArray(packages)) {
    addFailure(`Policy status "${status}" must be an object of package export arrays`);
    continue;
  }

  for (const [packageName, exports] of Object.entries(packages)) {
    if (!Array.isArray(exports)) {
      addFailure(`Policy entry ${status}.${packageName} must be an array`);
      continue;
    }
    for (const exportPath of exports) {
      const key = `${packageName}:${exportPath}`;
      const previous = classifiedExports.get(key);
      if (previous) {
        addFailure(
          `${specifier(packageName, exportPath)} appears in both ${previous} and ${status}`,
        );
      }
      classifiedExports.set(key, status);
      if (!actualExports.has(key)) {
        addFailure(`${specifier(packageName, exportPath)} is in policy but not package exports`);
      }
    }
  }
}

for (const [key, item] of actualExports) {
  if (!classifiedExports.has(key)) {
    addFailure(
      `${item.specifier} from ${relative(repoRoot, item.packageJsonPath)} has no stability status`,
    );
  }
}

// A package root may not promise more than what it re-exports. Only direct
// re-exports count: `export *` and named re-exports without @deprecated on
// every specifier. Deprecated re-exports are on their way out of the root and
// may point at less stable modules until they are removed.
function directRootReExports(packageDir) {
  const indexPath = join(packageDir, "src", "index.ts");
  const source = ts.createSourceFile(
    indexPath,
    readFileSync(indexPath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const modules = [];
  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier) continue;
    const target = statement.moduleSpecifier.text;
    const clause = statement.exportClause;
    const allDeprecated =
      clause &&
      ts.isNamedExports(clause) &&
      clause.elements.length > 0 &&
      clause.elements.every((element) =>
        ts.getJSDocTags(element).some((tag) => tag.tagName.text === "deprecated"),
      );
    if (!allDeprecated) modules.push(target);
  }
  return modules;
}

function exportPathForModule(packageJson, packageDir, target) {
  if (!target.startsWith("./")) return undefined;
  const source = join(packageDir, "src", `${target.slice(2)}.ts`);
  const entries = packageJson.loggerjsSubpathEntries ?? {};
  for (const [exportPath, conditions] of Object.entries(packageJson.exports ?? {})) {
    if (exportPath === ".") continue;
    const importTarget = typeof conditions === "string" ? conditions : conditions.import;
    const stem = importTarget?.split("/").pop()?.replace(/\.js$/, "");
    if (stem && entries[stem] && join(packageDir, entries[stem]) === source) return exportPath;
  }
  return undefined;
}

for (const item of actualExports.values()) {
  if (item.exportPath !== ".") continue;
  const rootStatus = classifiedExports.get(`${item.packageName}:.`);
  if (!rootStatus) continue;
  const packageDir = dirname(item.packageJsonPath);
  const packageJson = JSON.parse(readFileSync(item.packageJsonPath, "utf8"));

  for (const target of directRootReExports(packageDir)) {
    const reExported = target.startsWith("@loggerjs/")
      ? { key: `${target}:.`, label: target }
      : (() => {
          const exportPath = exportPathForModule(packageJson, packageDir, target);
          return exportPath
            ? {
                key: `${item.packageName}:${exportPath}`,
                label: specifier(item.packageName, exportPath),
              }
            : undefined;
        })();
    if (!reExported) continue;
    const reExportedStatus = classifiedExports.get(reExported.key);
    if (
      reExportedStatus &&
      (statusRank.get(reExportedStatus) ?? 0) > (statusRank.get(rootStatus) ?? 0)
    ) {
      addFailure(
        `${item.packageName} root is ${rootStatus} but directly re-exports ${reExported.label}, which is ${reExportedStatus}; deprecate those root re-exports or classify the root no higher than them`,
      );
    }
  }
}

for (const status of Object.keys(policy)) {
  if (!statuses.includes(status)) addFailure(`Unknown policy status "${status}"`);
}

for (const requiredText of [
  "api-stability.policy.json",
  "Stable v1 Candidate",
  "Compatible Public Surface",
  "Experimental Before v1",
]) {
  if (!docs.includes(requiredText))
    addFailure(`docs/API-STABILITY.md must mention ${requiredText}`);
}

if (failures.length > 0) {
  console.error("API stability policy verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Verified API stability policy for ${actualExports.size} package export entries across ${statuses.length} statuses.`,
);
