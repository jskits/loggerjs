---
"@loggerjs/core": major
"@loggerjs/browser": major
"@loggerjs/node": major
"@loggerjs/pretty": major
"@loggerjs/processors": major
"@loggerjs/codecs": major
"@loggerjs/otel": major
"@loggerjs/sentry": major
"@loggerjs/loki": major
"@loggerjs/datadog": major
"@loggerjs/elastic": major
"@loggerjs/cloudwatch": major
"@loggerjs/database": major
---

Require Node 22 or later: every package declares `engines.node: ">=22.0.0"`, and CI smoke-tests the packed packages on Node 22.0.0, the latest Node 22, and Node 24. Node 20 is no longer supported. Each Node line a major ships with stays supported for that whole major (see GOVERNANCE).
