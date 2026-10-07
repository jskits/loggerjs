import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packagesRoot = join(repoRoot, "packages");
const expectedRepositoryUrl = "git+https://github.com/jskits/loggerjs.git";
const requiredFilesField = ["dist", "README.md", "LICENSE"];
const requiredPackedFiles = [
  "package.json",
  "README.md",
  "LICENSE",
  "dist/index.js",
  "dist/index.d.ts",
];
// Keep in sync with the lowest version in the ci.yml node-compat matrix, which
// smoke-tests the packed packages on that runtime.
const supportedNodeRange = ">=22.0.0";
const forbiddenPackedPrefixes = ["src/", "test/", ".turbo/", "node_modules/"];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function packageDirs() {
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(packagesRoot, entry.name))
    .filter((dir) => existsSync(join(dir, "package.json")))
    .toSorted();
}

function collectExportTargets(value) {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap((entry) => collectExportTargets(entry));
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed in ${relative(repoRoot, cwd)}\n${result.stdout}${result.stderr}`,
    );
  }
  return result.stdout;
}

function assert(condition, failures, message) {
  if (!condition) failures.push(message);
}

const failures = [];
const publishablePackages = [];

const ciWorkflow = readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf8");
const nodeFloor = supportedNodeRange.slice(2);
assert(
  ciWorkflow.includes(`- ${nodeFloor}\n`),
  failures,
  `ci.yml node-compat matrix must smoke-test the engines floor ${nodeFloor}`,
);

for (const packageDir of packageDirs()) {
  const manifestPath = join(packageDir, "package.json");
  const manifest = readJson(manifestPath);
  if (manifest.private) continue;

  const relativePackageDir = relative(repoRoot, packageDir);
  publishablePackages.push(manifest.name);

  assert(manifest.version, failures, `${manifest.name}: missing version`);
  assert(manifest.license === "MIT", failures, `${manifest.name}: license must be MIT`);
  assert(manifest.type === "module", failures, `${manifest.name}: type must be module`);
  assert(manifest.sideEffects === false, failures, `${manifest.name}: sideEffects must be false`);
  assert(
    manifest.engines?.node === supportedNodeRange,
    failures,
    `${manifest.name}: engines.node must be "${supportedNodeRange}"`,
  );
  assert(
    manifest.publishConfig?.access === "public",
    failures,
    `${manifest.name}: publishConfig.access must be public`,
  );
  assert(
    manifest.repository?.url === expectedRepositoryUrl,
    failures,
    `${manifest.name}: repository.url must be ${expectedRepositoryUrl}`,
  );
  assert(
    manifest.repository?.directory === relativePackageDir,
    failures,
    `${manifest.name}: repository.directory must be ${relativePackageDir}`,
  );
  assert(
    manifest.homepage ===
      `https://github.com/jskits/loggerjs/tree/main/${relativePackageDir}#readme`,
    failures,
    `${manifest.name}: homepage must point at its package README`,
  );
  assert(
    manifest.bugs?.url === "https://github.com/jskits/loggerjs/issues",
    failures,
    `${manifest.name}: bugs.url must point at the repo issues page`,
  );

  for (const file of requiredFilesField) {
    assert(
      manifest.files?.includes(file),
      failures,
      `${manifest.name}: files must include ${file}`,
    );
  }

  // Internal dependencies publish as caret ranges so a consumer who upgrades
  // @loggerjs/core alone can dedupe it instead of installing a second copy.
  for (const [dependencyName, range] of Object.entries(manifest.dependencies ?? {})) {
    if (!dependencyName.startsWith("@loggerjs/")) continue;
    assert(
      range === "workspace:^",
      failures,
      `${manifest.name}: dependency ${dependencyName} must use "workspace:^" (found "${range}")`,
    );
  }

  assert(manifest.exports?.["."], failures, `${manifest.name}: exports must include "."`);
  assert(
    manifest.exports?.["."]?.types,
    failures,
    `${manifest.name}: root export must include types`,
  );
  assert(
    manifest.exports?.["."]?.import,
    failures,
    `${manifest.name}: root export must include import`,
  );

  const exportTargets = new Set(collectExportTargets(manifest.exports));
  for (const target of exportTargets) {
    if (!target.startsWith("./")) continue;
    assert(
      existsSync(join(packageDir, target)),
      failures,
      `${manifest.name}: export target ${target} does not exist`,
    );
  }

  const packOutput = run("npm", ["pack", "--dry-run", "--json"], packageDir);
  const [pack] = JSON.parse(packOutput);
  const packedFiles = new Set(pack.files.map((file) => file.path));

  for (const file of requiredPackedFiles) {
    assert(packedFiles.has(file), failures, `${manifest.name}: packed files must include ${file}`);
  }

  for (const target of exportTargets) {
    if (!target.startsWith("./")) continue;
    assert(
      packedFiles.has(target.slice(2)),
      failures,
      `${manifest.name}: packed files must include export target ${target}`,
    );
  }

  for (const packedFile of packedFiles) {
    for (const prefix of forbiddenPackedPrefixes) {
      assert(
        !packedFile.startsWith(prefix),
        failures,
        `${manifest.name}: package includes forbidden file ${packedFile}`,
      );
    }
  }
}

assert(publishablePackages.length > 0, failures, "No publishable packages found");

if (failures.length > 0) {
  console.error("Package validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Verified npm pack contents for ${publishablePackages.length} packages.`);
