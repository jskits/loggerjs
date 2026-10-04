import { existsSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";
import { defineConfig } from "rolldown";

const packageDir = process.cwd();
const packageJsonPath = join(packageDir, "package.json");
const entry = join(packageDir, "src/index.ts");

if (!existsSync(packageJsonPath) || !existsSync(entry)) {
  throw new Error("Run rolldown from a package directory that contains src/index.ts.");
}

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const subpathEntries = packageJson.loggerjsSubpathEntries ?? {};
const dependencyNames = [
  ...Object.keys(packageJson.dependencies ?? {}),
  ...Object.keys(packageJson.peerDependencies ?? {}),
  ...Object.keys(packageJson.optionalDependencies ?? {}),
];
const builtinNames = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
]);

const isExternal = (id) => {
  if (id.startsWith(".") || id.startsWith("/") || id.includes("\0")) return false;
  if (builtinNames.has(id)) return true;
  return dependencyNames.some((dependencyName) => {
    return id === dependencyName || id.startsWith(`${dependencyName}/`);
  });
};

const platform = packageJson.name === "@loggerjs/node" ? "node" : "neutral";
const entryInputs = {
  index: entry,
  ...Object.fromEntries(
    Object.entries(subpathEntries).map(([name, relativePath]) => [
      name,
      join(packageDir, relativePath),
    ]),
  ),
};

// All entries of a package build together so modules they share, including
// module-level state such as the logger registry, context manager, and meta
// counters, land in shared chunks with a single instance. Building each entry
// on its own gave every subpath (for example @loggerjs/core/context) a private
// copy of that state, invisible to loggers created from the root entry.
const shared = {
  input: entryInputs,
  external: isExternal,
  platform,
  tsconfig: join(packageDir, "tsconfig.json"),
  treeshake: true,
};

export default defineConfig([
  {
    ...shared,
    output: {
      dir: join(packageDir, "dist"),
      format: "esm",
      entryFileNames: "[name].js",
      chunkFileNames: "chunks/[name]-[hash].js",
      sourcemap: true,
    },
  },
  {
    ...shared,
    output: {
      dir: join(packageDir, "dist"),
      exports: "named",
      format: "cjs",
      entryFileNames: "[name].cjs",
      chunkFileNames: "chunks/[name]-[hash].cjs",
      sourcemap: true,
    },
  },
]);
