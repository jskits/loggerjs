export default {
  cleanTempDir: true,
  coverageAnalysis: "perTest",
  mutate: [
    "packages/core/src/events.ts",
    "packages/core/src/levels.ts",
    "packages/core/src/record.ts",
    "packages/core/src/event-route.ts",
    // Reliability/batch are the hardest delivery code (retry, backoff, circuit
    // breaker, bounded-concurrency flush, drop policies) and carry the
    // "production-hardened" promise, so they belong under mutation testing, not
    // just the simpler helpers above.
    "packages/core/src/transports/reliability.ts",
    "packages/core/src/transports/batch.ts",
    "!packages/**/*.d.ts",
  ],
  packageManager: "pnpm",
  plugins: ["@stryker-mutator/vitest-runner"],
  reporters: ["clear-text", "progress"],
  tempDirName: ".tmp/stryker",
  testRunner: "vitest",
  // reliability.ts and batch.ts (retry, backoff, circuit breaker, bounded-
  // concurrency flush, drop policies, UTF-8 byte estimation) are the hardest
  // delivery code and now carry dedicated mutation tests
  // (reliability-coverage.test.ts, batch-coverage.test.ts). Bringing them into
  // scope first exposed how untested they were (batch ~36%, reliability ~52%,
  // aggregate ~57%); the dedicated tests raised the aggregate to ~89%
  // (reliability ~99%, batch ~81%). The break floor sits below the measured
  // score with margin for run-to-run noise. This is a RATCHET: raise
  // break/low/high as the remaining batch.ts survivors (mostly equivalent
  // mutants) get killed; do not lower them.
  thresholds: {
    break: 85,
    high: 92,
    low: 88,
  },
  tsconfigFile: "packages/core/tsconfig.json",
  vitest: {
    configFile: "vitest.coverage.config.ts",
    related: true,
  },
};
