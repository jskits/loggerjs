import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Performance regression gate. Absolute ns/op numbers vary wildly across
// machines, so every gate is a ratio against a pino scenario measured in the
// same process on the same hardware. Limits are deliberately generous: the
// gate exists to catch structural regressions (a 2x slowdown from an
// accidental allocation or a dropped fast path), not 10% noise.
//
// Reference ratios as of 2026-06-14 (Apple Silicon, Node 22), after the
// getContext fast-path, fast-event-json encoder specialization, and
// codec-owned prepared record encoders:
//   disabled debug lazy log          / pino disabled debug   ~0.7-1.8
//   enabled logger record write      / pino ndjson noop sink ~0.45
//   batch transport enqueue          / pino ndjson noop sink ~0.75
//   loggerjs lean record sink        / pino ndjson noop sink ~1.10-1.25
//   loggerjs prepared lean record    / pino ndjson noop sink ~1.02-1.15
//   loggerjs fast-event-json record  / pino ndjson noop sink ~1.33
// The lean/fast-event limits are tightened from the old 2x/2.2x slack: that
// slack let the context-merge allocation regression (which pushed lean from
// ~1.05-1.15x to ~1.30x) pass unnoticed. The gate runs at 100k iterations, so the
// margin above the reference stays wide enough to absorb run-to-run noise
// rather than chase sub-10% drift; use a higher BENCH_GATE_ITERATIONS run for
// fine-grained ratio audits.
const GATES = [
  ["disabled debug lazy log", "pino disabled debug", 4],
  ["enabled logger record write transport", "pino ndjson noop sink", 1],
  ["batch transport enqueue", "pino ndjson noop sink", 1.5],
  ["loggerjs lean record sink", "pino ndjson noop sink", 1.5],
  ["loggerjs prepared lean record sink", "pino ndjson noop sink", 1.45],
  ["loggerjs fast-event-json record sink", "pino ndjson noop sink", 1.7],
];

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const iterations = process.env.BENCH_GATE_ITERATIONS ?? "100000";

const output = execFileSync(process.execPath, [join(repoRoot, "scripts/bench-node.mjs")], {
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
  env: { ...process.env, BENCH_JSON: "1", BENCH_ITERATIONS: iterations },
});

const { rows } = JSON.parse(output.trim().split("\n").pop());
const nsByScenario = new Map(rows.map((row) => [row.name, row.nsPerOp]));

const failures = [];
console.log(`Benchmark regression gate (${iterations} iterations):`);
for (const [scenario, baseline, limit] of GATES) {
  const scenarioNs = nsByScenario.get(scenario);
  const baselineNs = nsByScenario.get(baseline);
  if (scenarioNs === undefined || baselineNs === undefined) {
    failures.push(`missing scenario data for "${scenario}" vs "${baseline}"`);
    continue;
  }
  const ratio = scenarioNs / baselineNs;
  const status = ratio <= limit ? "ok" : "FAIL";
  console.log(
    `- [${status}] ${scenario}: ${scenarioNs.toFixed(0)}ns = ${ratio.toFixed(2)}x ${baseline} (limit ${limit}x)`,
  );
  if (ratio > limit) {
    failures.push(`${scenario} is ${ratio.toFixed(2)}x ${baseline}, limit is ${limit}x`);
  }
}

if (failures.length > 0) {
  console.error("\nBenchmark regression gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("Benchmark regression gate passed.");
