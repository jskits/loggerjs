import { defineConfig } from "vitest/config";

const packageCoverageThresholds = {
  "packages/browser/src/**/*.ts": {
    branches: 70,
    functions: 83,
    lines: 87,
    statements: 82,
  },
  "packages/cloudwatch/src/**/*.ts": {
    branches: 63,
    functions: 92,
    lines: 94,
    statements: 87,
  },
  "packages/codecs/src/**/*.ts": {
    branches: 82,
    functions: 95,
    lines: 95,
    statements: 90,
  },
  "packages/core/src/**/*.ts": {
    branches: 68,
    functions: 72,
    lines: 78,
    statements: 74,
  },
  "packages/database/src/**/*.ts": {
    branches: 71,
    functions: 94,
    lines: 86,
    statements: 82,
  },
  "packages/datadog/src/**/*.ts": {
    branches: 72,
    functions: 100,
    lines: 97,
    statements: 86,
  },
  "packages/elastic/src/**/*.ts": {
    branches: 75,
    functions: 91,
    lines: 100,
    statements: 89,
  },
  "packages/loki/src/**/*.ts": {
    branches: 71,
    functions: 92,
    lines: 94,
    statements: 88,
  },
  "packages/node/src/**/*.ts": {
    branches: 74,
    functions: 89,
    lines: 90,
    statements: 86,
  },
  "packages/otel/src/**/*.ts": {
    branches: 66,
    functions: 94,
    lines: 88,
    statements: 81,
  },
  "packages/pretty/src/**/*.ts": {
    branches: 68,
    functions: 75,
    lines: 82,
    statements: 73,
  },
  "packages/processors/src/**/*.ts": {
    branches: 78,
    functions: 97,
    lines: 90,
    statements: 85,
  },
  "packages/sentry/src/**/*.ts": {
    branches: 77,
    functions: 100,
    lines: 96,
    statements: 85,
  },
} as const;

export default defineConfig({
  test: {
    coverage: {
      exclude: ["**/*.d.ts", "**/dist/**", "**/test/**", "packages/node/src/ambient.d.ts"],
      include: ["packages/*/src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage",
      thresholds: {
        branches: 71,
        functions: 84,
        lines: 86,
        statements: 81,
        ...packageCoverageThresholds,
      },
    },
    include: ["packages/*/test/**/*.test.ts"],
  },
});
