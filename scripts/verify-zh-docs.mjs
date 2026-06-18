import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const docsRoot = join(repoRoot, "docs");
const zhDocsRoot = join(docsRoot, "zh");
const themeIndexPath = join(docsRoot, ".vitepress", "theme", "index.ts");
const localeRedirectPath = join(docsRoot, ".vitepress", "theme", "localeRedirect.ts");
const partialNotice = "中文站目前是维护性摘要和生成参考";

const failures = [];

function markdownFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...markdownFiles(path));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
  }
  return files;
}

for (const file of markdownFiles(zhDocsRoot)) {
  const contents = readFileSync(file, "utf8");
  if (!contents.includes(partialNotice)) {
    failures.push(`${relative(repoRoot, file)} is missing the zh partial-docs notice`);
  }
}

const themeIndex = readFileSync(themeIndexPath, "utf8");
if (themeIndex.includes("localeRedirect")) {
  failures.push("docs/.vitepress/theme/index.ts must not install automatic locale redirects");
}

if (existsSync(localeRedirectPath)) {
  failures.push("docs/.vitepress/theme/localeRedirect.ts should not exist");
}

if (failures.length > 0) {
  console.error("Chinese documentation verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  "Verified Chinese docs are marked as partial summaries and no auto-redirect is active.",
);
