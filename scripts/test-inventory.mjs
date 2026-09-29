#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const command = process.argv[2] ?? "run";
const outputPath = join(repoRoot, "docs", "TEST-INVENTORY.md");
const zhOutputPath = join(repoRoot, "docs", ".zh", "manual", "TEST-INVENTORY.md");
const jsonPath = join(repoRoot, ".tmp", "test-inventory", "vitest-results.json");
const vitestEntry = join(repoRoot, "node_modules", "vitest", "vitest.mjs");

if (command === "run") {
  const outputs = collectInventoryOutputs();
  for (const [path, markdown] of outputs) {
    writeFileSync(path, markdown);
    console.log(`Wrote ${relative(repoRoot, path)}`);
  }
} else if (command === "check") {
  const outputs = collectInventoryOutputs();
  let stale = false;
  for (const [path, expected] of outputs) {
    const actual = existsSync(path) ? readFileSync(path, "utf8") : "";
    if (actual !== expected) {
      console.error(`${relative(repoRoot, path)} is stale. Run: pnpm test:inventory`);
      stale = true;
    } else {
      console.log(`${relative(repoRoot, path)} is up to date.`);
    }
  }
  if (stale) process.exit(1);
} else {
  console.error("Usage: node scripts/test-inventory.mjs [run|check]");
  process.exit(1);
}

function collectInventoryOutputs() {
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
  const summary = summarizeReport(report);
  return [
    [outputPath, renderInventory(summary)],
    [zhOutputPath, renderChineseInventory(summary)],
  ];
}

function summarizeReport(report) {
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

  return {
    files: files.length,
    tests: report.numTotalTests,
    passed: report.numPassedTests,
    failed: report.numFailedTests,
    pending: report.numPendingTests,
    todo: report.numTodoTests,
    status: report.success ? "passed" : "failed",
    rows: packageRows
      .map((row) => `| ${row.packageName} | ${row.files} | ${row.tests} |`)
      .join("\n"),
  };
}

function renderInventory(summary) {
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
| Test files | ${summary.files} |
| Test cases | ${summary.tests} |
| Passed | ${summary.passed} |
| Failed | ${summary.failed} |
| Pending | ${summary.pending} |
| Todo | ${summary.todo} |
| Status | ${summary.status} |

## Package Breakdown

| Package | Test files | Test cases |
| --- | ---: | ---: |
${summary.rows}
`;
}

function renderChineseInventory(summary) {
  return `# 测试清单

本文件由 Vitest JSON reporter 生成，让仓库文档引用一个统一的测试计数来源，而不是手工维护数字。

新增、删除或重命名测试后重新生成：

\`\`\`bash
pnpm test:inventory
\`\`\`

CI 漂移检查：

\`\`\`bash
pnpm test:inventory:check
\`\`\`

## 当前快照

| 指标 | 数量 |
| --- | ---: |
| Test files | ${summary.files} |
| Test cases | ${summary.tests} |
| Passed | ${summary.passed} |
| Failed | ${summary.failed} |
| Pending | ${summary.pending} |
| Todo | ${summary.todo} |
| Status | ${summary.status} |

## 包拆分

| Package | Test files | Test cases |
| --- | ---: | ---: |
${summary.rows}
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
