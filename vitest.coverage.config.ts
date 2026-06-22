import { defineConfig } from "vitest/config";

const packageCoverageThresholds = {
  "packages/browser/src/**/*.ts": {
    branches: 71,
    functions: 84,
    lines: 88,
    statements: 83,
  },
  "packages/cloudwatch/src/**/*.ts": {
    branches: 78,
    functions: 92,
    lines: 96,
    statements: 92,
  },
  "packages/codecs/src/**/*.ts": {
    branches: 88,
    functions: 95,
    lines: 95,
    statements: 92,
  },
  "packages/core/src/**/*.ts": {
    branches: 80,
    functions: 88,
    lines: 90,
    statements: 87,
  },
  "packages/database/src/**/*.ts": {
    branches: 71,
    functions: 94,
    lines: 86,
    statements: 82,
  },
  "packages/datadog/src/**/*.ts": {
    branches: 88,
    functions: 100,
    lines: 100,
    statements: 94,
  },
  "packages/elastic/src/**/*.ts": {
    branches: 88,
    functions: 91,
    lines: 100,
    statements: 97,
  },
  "packages/loki/src/**/*.ts": {
    branches: 89,
    functions: 100,
    lines: 98,
    statements: 98,
  },
  "packages/node/src/**/*.ts": {
    branches: 74,
    functions: 89,
    lines: 90,
    statements: 86,
  },
  "packages/otel/src/**/*.ts": {
    branches: 80,
    functions: 100,
    lines: 98,
    statements: 94,
  },
  "packages/pretty/src/**/*.ts": {
    branches: 82,
    functions: 88,
    lines: 92,
    statements: 88,
  },
  "packages/processors/src/**/*.ts": {
    branches: 79,
    functions: 97,
    lines: 92,
    statements: 87,
  },
  "packages/sentry/src/**/*.ts": {
    branches: 82,
    functions: 100,
    lines: 96,
    statements: 87,
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
        // Ratchet from the current measured coverage floor. Raise these after
        // coverage improves; do not lower without an explicit quality review.
        branches: 76,
        functions: 90,
        lines: 90,
        statements: 86,
        ...packageCoverageThresholds,
      },
    },
    include: ["packages/*/test/**/*.test.ts"],
  },
});
