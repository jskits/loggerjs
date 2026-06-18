import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const checks = [
  {
    file: "docs/INTEGRATIONS.md",
    text: "Wraps `$queryRaw` / `$executeRaw` raw-query variants only",
  },
  {
    file: "docs/INTEGRATIONS.md",
    text: 'does not subscribe to `$on("query")`',
  },
  {
    file: "docs/INTEGRATIONS.md",
    text: "does not hook `Worker` or `QueueEvents` lifecycle events",
  },
  {
    file: "docs/INTEGRATIONS.md",
    text: "Express-compatible Nest middleware",
  },
  {
    file: "packages/node/README.md",
    text: "Coverage notes:",
  },
  {
    file: "packages/node/src/prisma-integration.ts",
    text: "does not capture typed model",
  },
  {
    file: "packages/node/src/bullmq-integration.ts",
    text: "does not hook `Worker` or",
  },
  {
    file: "packages/node/src/nest-integration.ts",
    text: "Express-compatible Nest middleware adapter",
  },
];

const failures = [];

for (const check of checks) {
  const contents = readFileSync(join(repoRoot, check.file), "utf8");
  if (!contents.includes(check.text)) {
    failures.push(`${check.file} is missing: ${check.text}`);
  }
}

if (failures.length > 0) {
  console.error("Integration limitation verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Verified documented Prisma, BullMQ, and Nest integration limits.");
