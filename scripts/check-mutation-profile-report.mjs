import { readFileSync } from "node:fs";
import { join } from "node:path";

const profileName = process.argv[2];

const profileThresholds = {
  network: {
    "packages/browser/src/http-transport.ts": 70,
    "packages/cloudwatch/src/index.ts": 80,
    "packages/datadog/src/index.ts": 70,
    "packages/elastic/src/index.ts": 75,
    "packages/loki/src/index.ts": 75,
    "packages/node/src/http-transport.ts": 85,
    "packages/otel/src/otlp-json.ts": 85,
    "packages/sentry/src/index.ts": 85,
  },
  privacy: {
    "packages/processors/src/normalize-error.ts": 80,
    "packages/processors/src/privacy-guard.ts": 82,
    "packages/processors/src/redact.ts": 85,
  },
};

const detectedStatuses = new Set(["Killed", "Timeout"]);
const undetectedStatuses = new Set(["Survived", "NoCoverage"]);
const excludedStatuses = new Set(["CompileError", "Ignored", "Pending", "RuntimeError"]);

function usage() {
  const profiles = Object.keys(profileThresholds).join(", ");
  throw new Error(`Usage: node scripts/check-mutation-profile-report.mjs <${profiles}>`);
}

function mutationScore(mutants) {
  let detected = 0;
  let undetected = 0;
  let excluded = 0;
  const unknownStatuses = new Set();

  for (const mutant of mutants) {
    if (detectedStatuses.has(mutant.status)) {
      detected += 1;
    } else if (undetectedStatuses.has(mutant.status)) {
      undetected += 1;
    } else if (excludedStatuses.has(mutant.status)) {
      excluded += 1;
    } else {
      unknownStatuses.add(String(mutant.status));
    }
  }

  const total = detected + undetected;
  return {
    detected,
    excluded,
    score: total === 0 ? 100 : (detected / total) * 100,
    total,
    unknownStatuses,
  };
}

if (!profileName || !profileThresholds[profileName]) usage();

const reportPath = join(".tmp", "mutation-reports", `${profileName}.json`);
const report = JSON.parse(readFileSync(reportPath, "utf8"));
const failures = [];

for (const [filePath, minimumScore] of Object.entries(profileThresholds[profileName])) {
  const file = report.files?.[filePath];
  if (!file) {
    failures.push(`${filePath}: missing from ${reportPath}`);
    continue;
  }

  const result = mutationScore(file.mutants ?? []);
  if (result.unknownStatuses.size > 0) {
    failures.push(
      `${filePath}: unknown mutation status ${[...result.unknownStatuses].toSorted().join(", ")}`,
    );
    continue;
  }

  const renderedScore = result.score.toFixed(2);
  const renderedMinimum = minimumScore.toFixed(2);
  if (result.score < minimumScore) {
    failures.push(`${filePath}: ${renderedScore} < ${renderedMinimum}`);
  } else {
    const excluded = result.excluded === 0 ? "" : ` (${result.excluded} invalid/ignored excluded)`;
    console.log(`${filePath}: ${renderedScore} >= ${renderedMinimum}${excluded}`);
  }
}

if (failures.length > 0) {
  console.error(`Mutation profile ${profileName} per-file threshold failures:`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Verified ${profileName} per-file mutation thresholds.`);
