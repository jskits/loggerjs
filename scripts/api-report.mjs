import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const reportsRoot = join(repoRoot, "api-reports");
const check = process.argv.includes("--check");

const packages = [
  ["@loggerjs/core", "packages/core"],
  ["@loggerjs/browser", "packages/browser"],
  ["@loggerjs/node", "packages/node"],
  ["@loggerjs/codecs", "packages/codecs"],
  ["@loggerjs/processors", "packages/processors"],
  ["@loggerjs/otel", "packages/otel"],
  ["@loggerjs/sentry", "packages/sentry"],
  ["@loggerjs/loki", "packages/loki"],
  ["@loggerjs/datadog", "packages/datadog"],
  ["@loggerjs/elastic", "packages/elastic"],
  ["@loggerjs/cloudwatch", "packages/cloudwatch"],
];

function declarationFiles(dir, root = dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolutePath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...declarationFiles(absolutePath, root));
    } else if (entry.isFile() && entry.name.endsWith(".d.ts")) {
      files.push(relative(root, absolutePath));
    }
  }
  return files.toSorted();
}

function normalizeDeclaration(contents) {
  return contents
    .replaceAll("\r\n", "\n")
    .replace(/\n\/\/# sourceMappingURL=.*$/gm, "")
    .trimEnd();
}

function reportPath(packageName) {
  return join(reportsRoot, `${packageName.replace("@", "").replace("/", "-")}.api.md`);
}

function generateReport(packageName, packagePath) {
  const distRoot = join(repoRoot, packagePath, "dist");
  if (!existsSync(distRoot)) {
    throw new Error(`Missing ${packagePath}/dist. Run pnpm build before generating API reports.`);
  }

  const sections = [
    `# API Report: ${packageName}`,
    "",
    `Generated from \`${packagePath}/dist/**/*.d.ts\`.`,
    "Update with `pnpm build && pnpm api:report` after intentional public API changes.",
  ];

  for (const declarationFile of declarationFiles(distRoot)) {
    const contents = normalizeDeclaration(readFileSync(join(distRoot, declarationFile), "utf8"));
    sections.push("", `## ${declarationFile}`, "", "```ts", contents, "```");
  }

  return `${sections.join("\n")}\n`;
}

const failures = [];
mkdirSync(reportsRoot, { recursive: true });

for (const [packageName, packagePath] of packages) {
  const nextReport = generateReport(packageName, packagePath);
  const path = reportPath(packageName);

  if (check) {
    if (!existsSync(path)) {
      failures.push(`${packageName}: missing ${relative(repoRoot, path)}`);
      continue;
    }

    const currentReport = readFileSync(path, "utf8").replaceAll("\r\n", "\n");
    if (currentReport !== nextReport) {
      failures.push(`${packageName}: ${relative(repoRoot, path)} is out of date`);
    }
  } else {
    writeFileSync(path, nextReport);
  }
}

if (failures.length > 0) {
  console.error("API reports are out of date:");
  for (const failure of failures) console.error(`- ${failure}`);
  console.error("Run `pnpm build && pnpm api:report` and review the generated diff.");
  process.exitCode = 1;
} else if (check) {
  console.log(`Verified ${packages.length} API reports.`);
} else {
  console.log(`Wrote ${packages.length} API reports.`);
}
