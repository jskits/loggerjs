#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const command = process.argv[2] ?? "run";
const outputPath = join(repoRoot, "docs", "TEST-INVENTORY.md");
const jsonPath = join(repoRoot, ".tmp", "test-inventory", "vitest-results.json");
const vitestEntry = join(repoRoot, "node_modules", "vitest", "vitest.mjs");

if (command === "run") {
  const markdown = collectInventoryMarkdown();
  writeFileSync(outputPath, markdown);
  console.log(`Wrote ${relative(repoRoot, outputPath)}`);
} else if (command === "check") {
  const expected = collectInventoryMarkdown();
  const actual = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : "";
  if (actual !== expected) {
    console.error(`${relative(repoRoot, outputPath)} is stale. Run: pnpm test:inventory`);
    process.exit(1);
  }
  console.log(`${relative(repoRoot, outputPath)} is up to date.`);
} else {
  console.error("Usage: node scripts/test-inventory.mjs [run|check]");
  process.exit(1);
}

function collectInventoryMarkdown() {
  mkdirSync(dirname(jsonPath), { recursive: true });
  execFileSync(
    process.execPath,
    [
      vitestEntry,
      "run",
      "--config",
      "vitest.coverage.config.ts",
      "--reporter=json",
      `--outputFile=${jsonPath}`,
    ],
    { cwd: repoRoot, stdio: "inherit" },
  );

  const report = JSON.parse(readFileSync(jsonPath, "utf8"));
  return renderInventory(report);
}

function renderInventory(report) {
  const files = [...report.testResults].toSorted((left, right) =>
    left.name.localeCompare(right.name),
  );
  const packageRows = summarizePackages(files);
  const assertionTotal = packageRows.reduce((sum, row) => sum + row.tests, 0);

  if (assertionTotal !== report.numTotalTests) {
    throw new Error(
      `Vitest JSON mismatch: assertionResults total ${assertionTotal}, reporter total ${report.numTotalTests}`,
    );
  }

  const status = report.success ? "passed" : "failed";
  const rows = packageRows
    .map((row) => `| ${row.packageName} | ${row.files} | ${row.tests} |`)
    .join("\n");

  return `# Test Inventory

This file is generated from the Vitest JSON reporter so repository docs can cite
one test-count source instead of hand-maintained numbers.

Regenerate after adding, removing, or renaming tests:

\`\`\`bash
pnpm test:inventory
\`\`\`

CI drift check:

\`\`\`bash
pnpm test:inventory:check
\`\`\`

## Current Snapshot

| Metric | Count |
| --- | ---: |
| Test files | ${files.length} |
| Test cases | ${report.numTotalTests} |
| Passed | ${report.numPassedTests} |
| Failed | ${report.numFailedTests} |
| Pending | ${report.numPendingTests} |
| Todo | ${report.numTodoTests} |
| Status | ${status} |

## Package Breakdown

| Package | Test files | Test cases |
| --- | ---: | ---: |
${rows}
`;
}

function summarizePackages(files) {
  const packages = new Map();

  for (const file of files) {
    const packageName = packageNameFor(file.name);
    const current = packages.get(packageName) ?? { packageName, files: 0, tests: 0 };
    current.files += 1;
    current.tests += file.assertionResults.length;
    packages.set(packageName, current);
  }

  return [...packages.values()].toSorted((left, right) =>
    left.packageName.localeCompare(right.packageName),
  );
}

function packageNameFor(filePath) {
  const relativePath = relative(repoRoot, filePath).replaceAll("\\", "/");
  const match = /^packages\/([^/]+)\//.exec(relativePath);
  return match ? `@loggerjs/${match[1]}` : "(root)";
}
