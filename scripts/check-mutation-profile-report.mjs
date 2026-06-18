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

const detectedStatuses = new Set(["Killed", "TimedOut"]);
const undetectedStatuses = new Set(["Survived", "NoCoverage"]);

function usage() {
  const profiles = Object.keys(profileThresholds).join(", ");
  throw new Error(`Usage: node scripts/check-mutation-profile-report.mjs <${profiles}>`);
}

function mutationScore(mutants) {
  let detected = 0;
  let undetected = 0;

  for (const mutant of mutants) {
    if (detectedStatuses.has(mutant.status)) {
      detected += 1;
    } else if (undetectedStatuses.has(mutant.status)) {
      undetected += 1;
    }
  }

  const total = detected + undetected;
  return total === 0 ? 100 : (detected / total) * 100;
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

  const score = mutationScore(file.mutants ?? []);
  const renderedScore = score.toFixed(2);
  const renderedMinimum = minimumScore.toFixed(2);
  if (score < minimumScore) {
    failures.push(`${filePath}: ${renderedScore} < ${renderedMinimum}`);
  } else {
    console.log(`${filePath}: ${renderedScore} >= ${renderedMinimum}`);
  }
}

if (failures.length > 0) {
  console.error(`Mutation profile ${profileName} per-file threshold failures:`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Verified ${profileName} per-file mutation thresholds.`);
