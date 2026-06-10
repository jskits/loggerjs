const scopes = [
  "browser",
  "build",
  "codecs",
  "core",
  "deps",
  "docs",
  "examples",
  "node",
  "otel",
  "processors",
  "release",
  "repo",
];

export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-case": [2, "always", "kebab-case"],
    "scope-enum": [2, "always", scopes],
  },
  prompt: {
    scopes,
    allowCustomScopes: false,
    allowEmptyScopes: true,
    customScopesAlign: "bottom",
    defaultScope: "repo",
    useEmoji: false,
  },
};
