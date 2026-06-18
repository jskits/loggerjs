const coreMutationTargets = [
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
];

const networkMutationTargets = [
  "packages/browser/src/http-transport.ts",
  "packages/cloudwatch/src/index.ts",
  "packages/datadog/src/index.ts",
  "packages/elastic/src/index.ts",
  "packages/loki/src/index.ts",
  "packages/node/src/http-transport.ts",
  "packages/otel/src/otlp-json.ts",
  "packages/sentry/src/index.ts",
];

const privacyMutationTargets = [
  "packages/processors/src/privacy-guard.ts",
  "packages/processors/src/redact.ts",
  "packages/processors/src/normalize-error.ts",
];

const profileName = process.env.LOGGERJS_MUTATION_PROFILE ?? "pr";

const profiles = {
  pr: {
    description: "PR gate for core record/event plus batch/reliability delivery.",
    mutate: coreMutationTargets,
    thresholds: {
      break: 85,
      high: 92,
      low: 88,
    },
  },
  network: {
    description: "Nightly network/vendor transport delivery contract profile.",
    mutate: networkMutationTargets,
    thresholds: {
      break: 70,
      high: 75,
      low: 70,
    },
  },
  privacy: {
    description: "Nightly privacy/redaction processor profile.",
    mutate: privacyMutationTargets,
    thresholds: {
      break: 78,
      high: 83,
      low: 79,
    },
  },
  release: {
    description: "Release profile covering all high-risk mutation targets.",
    mutate: [...coreMutationTargets, ...networkMutationTargets, ...privacyMutationTargets],
    thresholds: {
      break: 70,
      high: 80,
      low: 75,
    },
  },
};

const profile = profiles[profileName];
if (!profile) {
  throw new Error(
    `Unknown LOGGERJS_MUTATION_PROFILE=${profileName}. Expected one of: ${Object.keys(
      profiles,
    ).join(", ")}`,
  );
}

export default {
  cleanTempDir: true,
  coverageAnalysis: "perTest",
  mutate: [...profile.mutate, "!packages/**/*.d.ts"],
  packageManager: "pnpm",
  plugins: ["@stryker-mutator/vitest-runner"],
  reporters: ["clear-text", "progress"],
  tempDirName: `.tmp/stryker/${profileName}`,
  testRunner: "vitest",
  // Profile intent:
  // - pr: fast mutation gate with the established core reliability ratchet.
  // - network/privacy: broader nightly profiles for production delivery and
  //   privacy promises that should not slow every PR.
  // - release: high-risk aggregate profile before publishing.
  //
  // Thresholds are ratchets. Raise them after surviving mutants are killed or
  // classified; do not lower without an explicit quality review.
  thresholds: profile.thresholds,
  tsconfigFile: "tsconfig.mutation.json",
  vitest: {
    configFile: "vitest.coverage.config.ts",
    related: profileName !== "release",
  },
};
