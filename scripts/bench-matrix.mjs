#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const benchNodePath = join(repoRoot, "scripts", "bench-node.mjs");
const artifactSchema = "loggerjs.benchmark.matrix.v1";
const contenderNames = ["pino ndjson", "loggerjs lean", "loggerjs prepared"];

const rawArgs = process.argv.slice(2);
const command = rawArgs[0] && !rawArgs[0].startsWith("-") ? rawArgs.shift() : "run";
const { options, positionals } = parseArgs(rawArgs);

if (command === "help" || options.help) {
  printHelp();
} else if (command === "run") {
  runLocalMatrix();
} else if (command === "aggregate") {
  aggregateMatrix();
} else {
  fail(`Unknown command "${command}". Run: node scripts/bench-matrix.mjs help`);
}

function parseArgs(args) {
  const parsedOptions = {};
  const parsedPositionals = [];

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--") continue;
    if (!arg.startsWith("--")) {
      parsedPositionals.push(arg);
      continue;
    }

    const eqIndex = arg.indexOf("=");
    if (eqIndex !== -1) {
      parsedOptions[arg.slice(2, eqIndex)] = arg.slice(eqIndex + 1);
      continue;
    }

    const key = arg.slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      parsedOptions[key] = next;
      index++;
    } else {
      parsedOptions[key] = true;
    }
  }

  return { options: parsedOptions, positionals: parsedPositionals };
}

function numberOption(name, fallback) {
  const value = options[name];
  if (value === undefined || value === true) return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) fail(`--${name} must be a positive integer`);
  return parsed;
}

function stringOption(name, fallback) {
  const value = options[name];
  if (value === undefined || value === true) return fallback;
  return String(value);
}

function booleanOption(name) {
  return options[name] === true || options[name] === "true" || options[name] === "1";
}

function printHelp() {
  console.log(`LoggerJS benchmark matrix

Usage:
  node scripts/bench-matrix.mjs run [--runs=5] [--rounds=120] [--batch=5000] [--warmup=100000] [--label=name] [--out=benchmarks/matrix] [--build]
  node scripts/bench-matrix.mjs aggregate [files-or-dirs...] [--out=docs/BENCHMARK-MATRIX.md]

Examples:
  pnpm build
  pnpm bench:matrix -- --runs=5 --rounds=120 --label="$(hostname)-node22"
  pnpm bench:matrix:aggregate -- benchmarks/matrix --out docs/BENCHMARK-MATRIX.md

The run command wraps BENCH_AB=1 BENCH_JSON=1 node scripts/bench-node.mjs,
records machine/Git/runtime metadata, and writes JSON plus Markdown artifacts.
The aggregate command combines artifacts from multiple machines into one table.`);
}

function runLocalMatrix() {
  const runs = numberOption("runs", 5);
  const rounds = numberOption("rounds", 120);
  const batch = numberOption("batch", 5_000);
  const warmup = numberOption("warmup", 100_000);
  const outputDir = resolve(repoRoot, stringOption("out", "benchmarks/matrix"));
  const label = sanitizeLabel(stringOption("label", defaultLabel()));

  if (booleanOption("build")) {
    console.error("Building workspace before benchmark matrix...");
    execFileSync("pnpm", ["build"], { cwd: repoRoot, stdio: "inherit" });
  }

  mkdirSync(outputDir, { recursive: true });

  const metadata = collectMetadata(label);
  const samples = [];
  console.error(
    `Running ${runs} A/B benchmark sample(s): ${rounds} rounds x ${batch} ops/contender, ${warmup} warmup/contender`,
  );

  for (let index = 0; index < runs; index++) {
    const sample = runBenchNode({ rounds, batch, warmup });
    samples.push({
      index: index + 1,
      capturedAt: new Date().toISOString(),
      ...sample,
    });

    const pino = summaryValue(sample, "pino ndjson");
    const leanRatio = ratioValue(sample, "loggerjs lean", "pino ndjson");
    const preparedRatio = ratioValue(sample, "loggerjs prepared", "pino ndjson");
    console.error(
      `[${index + 1}/${runs}] pino=${formatNs(pino?.median)} lean/pino=${formatRatio(leanRatio?.median)} prepared/pino=${formatRatio(preparedRatio?.median)} spread=${formatPercent(sample.baselineSpreadPct)}`,
    );
  }

  const artifact = {
    schema: artifactSchema,
    createdAt: new Date().toISOString(),
    metadata,
    config: { runs, rounds, batch, warmup },
    runs: samples,
    aggregate: summarizeRuns(samples),
  };

  const timestamp = artifact.createdAt.replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
  const basePath = join(outputDir, `${timestamp}-${label}`);
  writeFileSync(`${basePath}.json`, `${JSON.stringify(artifact, null, 2)}\n`);
  writeFileSync(`${basePath}.md`, markdownForArtifact(artifact));

  console.log(`Wrote ${relativePath(`${basePath}.json`)}`);
  console.log(`Wrote ${relativePath(`${basePath}.md`)}`);
}

function aggregateMatrix() {
  const inputPaths = positionals.length > 0 ? positionals : ["benchmarks/matrix"];
  const artifacts = inputPaths.flatMap((inputPath) => loadArtifacts(resolve(repoRoot, inputPath)));
  if (artifacts.length === 0) fail("No benchmark matrix JSON artifacts found.");

  const markdown = markdownForMatrix(artifacts);
  const out = stringOption("out", "");
  if (out) {
    const outPath = resolve(repoRoot, out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, markdown);
    console.log(`Wrote ${relativePath(outPath)}`);
  } else {
    console.log(markdown);
  }
}

function runBenchNode({ rounds, batch, warmup }) {
  const env = {
    ...process.env,
    BENCH_AB: "1",
    BENCH_JSON: "1",
    BENCH_AB_ROUNDS: String(rounds),
    BENCH_AB_BATCH: String(batch),
    BENCH_AB_WARMUP: String(warmup),
  };

  const output = execFileSync(process.execPath, [benchNodePath], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
  });

  const trimmed = output.trim();
  const firstJson = trimmed.indexOf("{");
  if (firstJson === -1) fail("bench-node did not print JSON. Is BENCH_JSON still supported?");
  const parsed = JSON.parse(trimmed.slice(firstJson));
  if (parsed.mode !== "ab") fail("bench-node JSON is not an interleaved A/B result.");
  return parsed;
}

function collectMetadata(label) {
  const cpus = os.cpus();
  const rootPackage = readJson(join(repoRoot, "package.json")) ?? {};
  const gitStatus = shellText("git", ["status", "--short"]);

  return {
    label,
    host: os.hostname(),
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    cpuModel: cpus[0]?.model?.trim() ?? "unknown",
    logicalCores: cpus.length,
    totalMemoryGb: Number((os.totalmem() / 1024 ** 3).toFixed(1)),
    node: process.version,
    v8: process.versions.v8,
    packageManager: rootPackage.packageManager ?? "unknown",
    dependencies: {
      pino: packageVersion("pino", rootPackage),
      winston: packageVersion("winston", rootPackage),
      logtape: packageVersion("@logtape/logtape", rootPackage),
    },
    git: {
      branch: shellText("git", ["branch", "--show-current"]) || "unknown",
      sha: shellText("git", ["rev-parse", "--short=12", "HEAD"]) || "unknown",
      dirty: gitStatus.length > 0,
    },
  };
}

function summarizeRuns(runs) {
  const contenders = Object.fromEntries(
    contenderNames.map((name) => [name, stats(runs.map((run) => summaryValue(run, name)?.median))]),
  );
  const ratios = {
    "loggerjs lean / pino ndjson": summarizeRatio(runs, "loggerjs lean", "pino ndjson"),
    "loggerjs prepared / pino ndjson": summarizeRatio(runs, "loggerjs prepared", "pino ndjson"),
    "loggerjs prepared / loggerjs lean": summarizeRatio(runs, "loggerjs prepared", "loggerjs lean"),
  };

  return {
    runs: runs.length,
    contenders,
    ratios,
    baselineSpreadPct: stats(runs.map((run) => run.baselineSpreadPct)),
  };
}

function summarizeRatio(runs, a, b) {
  const values = runs.map((run) => ratioValue(run, a, b)?.median);
  const valueStats = stats(values);
  return {
    ...valueStats,
    wins: values.filter((value) => Number.isFinite(value) && value < 1).length,
    total: values.filter(Number.isFinite).length,
    throughputPct: Number.isFinite(valueStats.median) ? 100 / valueStats.median : Number.NaN,
  };
}

function stats(values) {
  const numeric = values.filter(Number.isFinite).toSorted((a, b) => a - b);
  if (numeric.length === 0) {
    return {
      median: Number.NaN,
      p25: Number.NaN,
      p75: Number.NaN,
      min: Number.NaN,
      max: Number.NaN,
    };
  }

  return {
    median: percentile(numeric, 0.5),
    p25: percentile(numeric, 0.25),
    p75: percentile(numeric, 0.75),
    min: numeric[0],
    max: numeric[numeric.length - 1],
  };
}

function percentile(sortedAsc, p) {
  const position = (sortedAsc.length - 1) * p;
  const lo = Math.floor(position);
  const hi = Math.ceil(position);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (position - lo);
}

function summaryValue(run, name) {
  return run.summary?.find((entry) => entry.name === name);
}

function ratioValue(run, a, b) {
  return run.ratios?.find((entry) => entry.a === a && entry.b === b);
}

function markdownForArtifact(artifact) {
  const { metadata, aggregate, config } = artifact;
  const lean = aggregate.ratios["loggerjs lean / pino ndjson"];
  const prepared = aggregate.ratios["loggerjs prepared / pino ndjson"];
  const preparedVsLean = aggregate.ratios["loggerjs prepared / loggerjs lean"];

  return `# LoggerJS Benchmark Matrix - ${metadata.label}

Generated: ${artifact.createdAt}

| Field | Value |
| --- | --- |
| Git | ${metadata.git.branch}@${metadata.git.sha}${metadata.git.dirty ? " (dirty)" : ""} |
| Runtime | ${metadata.node}, V8 ${metadata.v8} |
| OS | ${metadata.platform}/${metadata.arch} ${metadata.osRelease} |
| CPU | ${metadata.cpuModel} (${metadata.logicalCores} logical cores) |
| Memory | ${metadata.totalMemoryGb} GB |
| Dependencies | pino ${metadata.dependencies.pino}, winston ${metadata.dependencies.winston}, LogTape ${metadata.dependencies.logtape} |
| Sampling | ${config.runs} runs, ${config.rounds} rounds x ${config.batch} ops, ${config.warmup} warmup |

| Path | Median ns/op | p25..p75 | Min..max |
| --- | ---: | ---: | ---: |
${contenderNames
  .map((name) => {
    const row = aggregate.contenders[name];
    return `| ${name} | ${formatNs(row.median)} | ${formatNs(row.p25)}..${formatNs(row.p75)} | ${formatNs(row.min)}..${formatNs(row.max)} |`;
  })
  .join("\n")}

| Ratio | Median latency | Throughput vs baseline | Wins |
| --- | ---: | ---: | ---: |
| loggerjs lean / pino ndjson | ${formatRatio(lean.median)} | ${formatPercent(lean.throughputPct)} | ${lean.wins}/${lean.total} |
| loggerjs prepared / pino ndjson | ${formatRatio(prepared.median)} | ${formatPercent(prepared.throughputPct)} | ${prepared.wins}/${prepared.total} |
| loggerjs prepared / loggerjs lean | ${formatRatio(preparedVsLean.median)} | ${formatPercent(preparedVsLean.throughputPct)} | ${preparedVsLean.wins}/${preparedVsLean.total} |

Baseline pino spread across local samples: ${formatPercent(aggregate.baselineSpreadPct.median)}

Interpretation: these are paired A/B ratios for this machine and runtime only.
Use \`pnpm bench:matrix:aggregate -- benchmarks/matrix --out docs/BENCHMARK-MATRIX.md\`
to combine artifacts from multiple machines into a publishable matrix.
`;
}

function markdownForMatrix(artifacts) {
  const sorted = artifacts.toSorted((a, b) => a.metadata.label.localeCompare(b.metadata.label));
  const generatedAt = new Date().toISOString();
  const coverage = evidenceCoverage(sorted);
  const rows = sorted
    .map((artifact) => {
      const { metadata, aggregate } = artifact;
      const lean = aggregate.ratios["loggerjs lean / pino ndjson"];
      const prepared = aggregate.ratios["loggerjs prepared / pino ndjson"];
      const result = resultLabel(lean.median, prepared.median);
      return `| ${metadata.label} | ${metadata.platform}/${metadata.arch} | ${trimCpu(metadata.cpuModel)} | ${metadata.node} | ${metadata.git.sha}${metadata.git.dirty ? "*" : ""} | ${aggregate.runs} | ${formatNs(aggregate.contenders["pino ndjson"].median)} | ${formatNs(aggregate.contenders["loggerjs lean"].median)} | ${formatNs(aggregate.contenders["loggerjs prepared"].median)} | ${formatRatio(lean.median)} (${formatPercent(lean.throughputPct)}) | ${formatRatio(prepared.median)} (${formatPercent(prepared.throughputPct)}) | ${result} |`;
    })
    .join("\n");

  return `# LoggerJS Benchmark Matrix

Generated: ${generatedAt}

This table aggregates local artifacts produced by \`pnpm bench:matrix\`.
Ratios are paired per-round latency medians from the interleaved A/B harness,
not one-off sequential-run ratios. A ratio below \`1.00x\` means the LoggerJS
path had lower latency than pino on that machine.

| Label | Platform | CPU | Node | Git | Runs | Pino ns | Lean ns | Prepared ns | Lean / pino | Prepared / pino | Result |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
${rows}

## Evidence Coverage

| Requirement | Status | Rows |
| --- | --- | --- |
| At least one non-Apple-Silicon runtime | ${coverage.hasNonAppleSilicon ? "Covered" : "Missing"} | ${coverage.platforms} |
| At least two Node major versions | ${coverage.hasMultipleNodeMajors ? "Covered" : "Missing"} | ${coverage.nodeMajors} |

Notes:

- The matrix proves only the listed machine/runtime combinations. Do not turn
  it into a universal "always faster than pino" claim.
- Keep README/BENCHMARKS wording scoped to the covered rows. If either evidence
  requirement above is missing, describe the numbers as reference-machine
  results.
- A dirty Git marker (\`*\`) means the artifact was captured with local changes.
- Reproduce a row with:

\`\`\`bash
pnpm build
pnpm bench:matrix -- --runs=5 --rounds=120 --label="<machine-node>"
\`\`\`
`;
}

function evidenceCoverage(artifacts) {
  const platforms = new Set();
  const nodeMajors = new Set();
  let hasNonAppleSilicon = false;

  for (const artifact of artifacts) {
    const { metadata } = artifact;
    platforms.add(`${metadata.platform}/${metadata.arch}`);
    nodeMajors.add(nodeMajor(metadata.node));
    if (!(metadata.platform === "darwin" && metadata.arch === "arm64")) {
      hasNonAppleSilicon = true;
    }
  }

  return {
    hasNonAppleSilicon,
    hasMultipleNodeMajors: nodeMajors.size >= 2,
    platforms: formatSet(platforms),
    nodeMajors: formatSet(nodeMajors),
  };
}

function nodeMajor(version) {
  const match = /^v?(\d+)/.exec(String(version));
  return match ? match[1] : "unknown";
}

function formatSet(values) {
  return [...values].toSorted().join(", ") || "none";
}

function resultLabel(leanRatio, preparedRatio) {
  if (preparedRatio < 1 && leanRatio < 1) return "LoggerJS lean + prepared faster";
  if (preparedRatio < 1) return "LoggerJS prepared faster";
  if (leanRatio < 1) return "LoggerJS lean faster";
  return "pino faster in this row";
}

function loadArtifacts(inputPath) {
  if (!existsSync(inputPath)) return [];
  const stat = statSync(inputPath);
  if (stat.isDirectory()) {
    return readdirSync(inputPath)
      .flatMap((entry) => loadArtifacts(join(inputPath, entry)))
      .filter(Boolean);
  }
  if (!stat.isFile() || !inputPath.endsWith(".json")) return [];

  const parsed = readJson(inputPath);
  return parsed?.schema === artifactSchema ? [parsed] : [];
}

function packageVersion(name, rootPackage) {
  const packagePath = join(repoRoot, "node_modules", ...name.split("/"), "package.json");
  const installed = readJson(packagePath)?.version;
  return (
    installed ??
    rootPackage.devDependencies?.[name] ??
    rootPackage.dependencies?.[name] ??
    "unknown"
  );
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function shellText(file, args) {
  try {
    return execFileSync(file, args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function defaultLabel() {
  return `${os.hostname()}-${process.platform}-${process.arch}-node-${process.versions.node}`;
}

function sanitizeLabel(label) {
  return (
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96) || "benchmark"
  );
}

function trimCpu(cpuModel) {
  return cpuModel.replace(/\s+/g, " ").slice(0, 56);
}

function formatNs(value) {
  return Number.isFinite(value) ? value.toFixed(value >= 100 ? 0 : 1) : "n/a";
}

function formatRatio(value) {
  return Number.isFinite(value) ? `${value.toFixed(3)}x` : "n/a";
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : "n/a";
}

function relativePath(path) {
  return path.startsWith(repoRoot) ? path.slice(repoRoot.length + 1) : path;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
