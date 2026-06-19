import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const docsRoot = join(repoRoot, "docs");
const zhDocsRoot = join(docsRoot, "zh");
const zhManualRoot = join(docsRoot, ".zh", "manual");
const themeIndexPath = join(docsRoot, ".vitepress", "theme", "index.ts");
const localeRedirectPath = join(docsRoot, ".vitepress", "theme", "localeRedirect.ts");
const stalePartialNotice = "中文站目前是维护性摘要和生成参考";
const generatedReferenceNotice = "本页由仓库元数据、API reports 或示例目录生成";
const generatedTopLevelPages = new Set(["examples.md", "index.md", "llms.md"]);
const standaloneTopLevelPages = new Set(["AI-SKILL.md"]);

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

const manualFiles = markdownFiles(zhManualRoot);
const zhFiles = markdownFiles(zhDocsRoot);

for (const file of manualFiles) {
  const relativePath = relative(zhManualRoot, file);
  const generatedPath = join(zhDocsRoot, relativePath);
  if (!existsSync(generatedPath)) {
    failures.push(
      `${relative(repoRoot, file)} has no generated Chinese page at ${relative(repoRoot, generatedPath)}`,
    );
  }
}

for (const file of zhFiles) {
  const contents = readFileSync(file, "utf8");
  const relativePath = relative(zhDocsRoot, file);
  const isGeneratedReference =
    relativePath === "examples.md" ||
    relativePath === "llms.md" ||
    relativePath.startsWith("reference/");
  const isTopLevelPage = !relativePath.includes("/");
  if (contents.includes(stalePartialNotice)) {
    failures.push(`${relative(repoRoot, file)} still describes Chinese docs as partial summaries`);
  }
  if (isGeneratedReference && !contents.includes(generatedReferenceNotice)) {
    failures.push(`${relative(repoRoot, file)} is missing the generated-reference notice`);
  }
  if (
    isTopLevelPage &&
    !isGeneratedReference &&
    !generatedTopLevelPages.has(relativePath) &&
    !standaloneTopLevelPages.has(relativePath)
  ) {
    const manualPath = join(zhManualRoot, relativePath);
    if (!existsSync(manualPath)) {
      failures.push(
        `${relative(repoRoot, file)} is missing its manual source at ${relative(repoRoot, manualPath)}`,
      );
    }
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
  "Verified Chinese docs are full-guide pages or marked generated references, with no auto-redirect active.",
);
