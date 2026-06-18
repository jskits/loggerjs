import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Performance regression gate. Cross-logger absolute ns/op comparisons from a
// sequential benchmark are not stable enough for CI: each scenario runs at a
// different moment, so CPU frequency, scheduler placement, and GC drift can
// dominate the ratio. The gate therefore consumes bench-node's interleaved A/B
// JSON, where every round times both contenders back-to-back and checks the
// median paired ratio.
//
// Limits are deliberately generous. They catch structural regressions such as a
// dropped fast path or accidental allocation loop, not ordinary machine noise.
const GATES = [
  {
    suite: "disabled",
    scenario: "loggerjs disabled",
    baseline: "pino disabled",
    limit: 4,
  },
  {
    suite: "enqueue",
    scenario: "loggerjs record write",
    baseline: "pino ndjson",
    limit: 1,
  },
  {
    suite: "enqueue",
    scenario: "loggerjs batch enqueue",
    baseline: "pino ndjson",
    limit: 1.5,
  },
  {
    suite: "fullpath",
    scenario: "loggerjs lean",
    baseline: "pino ndjson",
    limit: 1.5,
  },
  {
    suite: "fullpath",
    scenario: "loggerjs prepared",
    baseline: "pino ndjson",
    limit: 1.45,
  },
  {
    suite: "fullpath",
    scenario: "loggerjs fast-event record",
    baseline: "pino ndjson",
    limit: 1.7,
  },
  {
    suite: "fullpath",
    scenario: "loggerjs prepared",
    baseline: "loggerjs lean",
    limit: 1.1,
  },
];

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const rounds = process.env.BENCH_GATE_AB_ROUNDS ?? process.env.BENCH_AB_ROUNDS ?? "60";
const batch = process.env.BENCH_GATE_AB_BATCH ?? process.env.BENCH_AB_BATCH ?? "5000";
const warmup = process.env.BENCH_GATE_AB_WARMUP ?? process.env.BENCH_AB_WARMUP ?? "100000";

function runSuite(suite) {
  const output = execFileSync(process.execPath, [join(repoRoot, "scripts/bench-node.mjs")], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    env: {
      ...process.env,
      BENCH_AB: "1",
      BENCH_AB_BATCH: batch,
      BENCH_AB_ROUNDS: rounds,
      BENCH_AB_SUITE: suite,
      BENCH_AB_WARMUP: warmup,
      BENCH_JSON: "1",
    },
  });
  return JSON.parse(output.trim().split("\n").pop());
}

const suites = new Map();
for (const suite of new Set(GATES.map((gate) => gate.suite))) {
  suites.set(suite, runSuite(suite));
}

function ratioFor(suite, scenario, baseline) {
  const result = suites.get(suite);
  return result?.ratios.find((ratio) => ratio.a === scenario && ratio.b === baseline);
}

const failures = [];
console.log(`Benchmark regression gate (paired A/B: ${rounds} rounds x ${batch} ops):`);

for (const [suite, result] of suites) {
  console.log(
    `- suite ${suite}: baseline ${result.baseline}, spread ${result.baselineSpreadPct.toFixed(0)}%`,
  );
}

for (const { suite, scenario, baseline, limit } of GATES) {
  const ratio = ratioFor(suite, scenario, baseline);
  if (!ratio) {
    failures.push(`missing paired ratio for "${scenario}" vs "${baseline}" in suite ${suite}`);
    continue;
  }
  const status = ratio.median <= limit ? "ok" : "FAIL";
  console.log(
    `- [${status}] ${scenario}: ${ratio.median.toFixed(2)}x ${baseline} (paired median, limit ${limit}x, range ${ratio.min.toFixed(2)}..${ratio.max.toFixed(2)}x)`,
  );
  if (ratio.median > limit) {
    failures.push(`${scenario} is ${ratio.median.toFixed(2)}x ${baseline}, limit is ${limit}x`);
  }
}

if (failures.length > 0) {
  console.error("\nBenchmark regression gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Benchmark regression gate passed.");
