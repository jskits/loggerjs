import { defineConfig } from "vitest/config";

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
      },
    },
    include: ["packages/*/test/**/*.test.ts"],
  },
});
