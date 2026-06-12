import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packagesRoot = join(repoRoot, "packages");
const registry = readArg("--registry") ?? "https://registry.npmjs.org";
const tag = readArg("--tag") ?? "latest";
const access = readArg("--access") ?? "public";
const dryRun = process.argv.includes("--dry-run");

function readArg(name) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1];
  return undefined;
}

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

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
  });

  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(
      `${command} ${args.join(" ")} failed\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }

  return result;
}

function internalDependencyNames(manifest, packageNames) {
  const dependencyBlocks = [
    manifest.dependencies,
    manifest.peerDependencies,
    manifest.optionalDependencies,
  ];

  return dependencyBlocks
    .flatMap((block) => Object.keys(block ?? {}))
    .filter((name) => packageNames.has(name));
}

function sortByInternalDependencies(packages) {
  const byName = new Map(packages.map((pkg) => [pkg.manifest.name, pkg]));
  const packageNames = new Set(byName.keys());
  const visited = new Set();
  const visiting = new Set();
  const sorted = [];

  function visit(pkg) {
    if (visited.has(pkg.manifest.name)) return;
    if (visiting.has(pkg.manifest.name)) {
      throw new Error(`Circular package dependency detected at ${pkg.manifest.name}`);
    }

    visiting.add(pkg.manifest.name);
    for (const dependencyName of internalDependencyNames(pkg.manifest, packageNames)) {
      visit(byName.get(dependencyName));
    }
    visiting.delete(pkg.manifest.name);
    visited.add(pkg.manifest.name);
    sorted.push(pkg);
  }

  for (const pkg of packages) visit(pkg);
  return sorted;
}

function isPublished(pkg) {
  const spec = `${pkg.manifest.name}@${pkg.manifest.version}`;
  const result = run("npm", ["view", spec, "version", `--registry=${registry}`], {
    allowFailure: true,
  });

  if (result.status === 0) return true;

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (output.includes("E404") || output.includes("404 Not Found")) return false;

  throw new Error(`Unable to check published status for ${spec}\n${output}`);
}

const packages = sortByInternalDependencies(
  packageDirs()
    .map((dir) => ({ dir, manifest: readJson(join(dir, "package.json")) }))
    .filter((pkg) => !pkg.manifest.private),
);

let publishedCount = 0;
let skippedCount = 0;

for (const pkg of packages) {
  const spec = `${pkg.manifest.name}@${pkg.manifest.version}`;
  const packageDir = relative(repoRoot, pkg.dir);

  if (!dryRun && isPublished(pkg)) {
    skippedCount += 1;
    console.log(`${spec} is already published; skipping.`);
    continue;
  }

  const args = [
    "publish",
    "--dir",
    packageDir,
    "--access",
    access,
    "--tag",
    tag,
    "--no-git-checks",
    "--provenance",
  ];

  if (dryRun) args.push("--dry-run", "--json");

  console.log(`${dryRun ? "Dry-running" : "Publishing"} ${spec} with provenance.`);
  run("pnpm", args, { stdio: "inherit" });
  publishedCount += 1;
}

console.log(
  `${dryRun ? "Dry-run checked" : "Published"} ${publishedCount} package(s); skipped ${skippedCount} already published package(s).`,
);
