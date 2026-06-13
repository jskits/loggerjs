export default {
  cleanTempDir: true,
  coverageAnalysis: "perTest",
  mutate: [
    "packages/core/src/events.ts",
    "packages/core/src/levels.ts",
    "packages/core/src/record.ts",
    "packages/core/src/event-route.ts",
    "!packages/**/*.d.ts",
  ],
  packageManager: "pnpm",
  plugins: ["@stryker-mutator/vitest-runner"],
  reporters: ["clear-text", "progress"],
  tempDirName: ".tmp/stryker",
  testRunner: "vitest",
  thresholds: {
    break: 69,
    high: 80,
    low: 70,
  },
  tsconfigFile: "packages/core/tsconfig.json",
  vitest: {
    configFile: "vitest.coverage.config.ts",
    related: true,
  },
};
