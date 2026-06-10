import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

const roots = process.argv.slice(2);

if (roots.length === 0) {
  console.error("Usage: node scripts/fix-dts-extensions.mjs <dist-dir> [...dist-dir]");
  process.exit(1);
}

function declarationFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...declarationFiles(path));
    } else if (entry.isFile() && path.endsWith(".d.ts")) {
      files.push(path);
    }
  }
  return files;
}

function hasExplicitExtension(specifier) {
  const [withoutQuery] = specifier.split(/[?#]/, 1);
  return extname(withoutQuery) !== "";
}

function withJsExtension(specifier) {
  if (!specifier.startsWith(".") || hasExplicitExtension(specifier)) return specifier;
  const queryStart = specifier.search(/[?#]/);
  if (queryStart === -1) return `${specifier}.js`;
  return `${specifier.slice(0, queryStart)}.js${specifier.slice(queryStart)}`;
}

function fixSpecifiers(contents) {
  return contents
    .replaceAll(/(from\s+["'])(\.{1,2}\/[^"']+)(["'])/g, (_, prefix, specifier, suffix) => {
      return `${prefix}${withJsExtension(specifier)}${suffix}`;
    })
    .replaceAll(
      /(import\(\s*["'])(\.{1,2}\/[^"']+)(["']\s*\))/g,
      (_, prefix, specifier, suffix) => {
        return `${prefix}${withJsExtension(specifier)}${suffix}`;
      },
    );
}

for (const root of roots) {
  if (!statSync(root).isDirectory()) {
    throw new Error(`${root} is not a directory`);
  }

  for (const file of declarationFiles(root)) {
    const current = readFileSync(file, "utf8");
    const next = fixSpecifiers(current);
    if (next !== current) writeFileSync(file, next);
  }
}
