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

export default defineConfig({
  input: entry,
  external: isExternal,
  platform,
  tsconfig: join(packageDir, "tsconfig.json"),
  treeshake: true,
  output: [
    {
      file: join(packageDir, "dist/index.js"),
      format: "esm",
      sourcemap: true,
    },
    {
      exports: "named",
      file: join(packageDir, "dist/index.cjs"),
      format: "cjs",
      sourcemap: true,
    },
  ],
});
