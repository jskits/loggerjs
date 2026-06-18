import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

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

for (const item of actualExports.values()) {
  if (item.exportPath !== ".") continue;
  const rootStatus = classifiedExports.get(`${item.packageName}:.`);
  if (rootStatus !== "stable") continue;

  for (const candidate of actualExports.values()) {
    if (candidate.packageName !== item.packageName || candidate.exportPath === ".") continue;
    const candidateStatus = classifiedExports.get(
      `${candidate.packageName}:${candidate.exportPath}`,
    );
    if (
      candidateStatus &&
      (statusRank.get(candidateStatus) ?? 0) > (statusRank.get(rootStatus) ?? 0)
    ) {
      addFailure(
        `${item.packageName} root export is stable but ${candidate.specifier} is ${candidateStatus}; classify the root no higher than the lowest re-exported public surface`,
      );
      break;
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
