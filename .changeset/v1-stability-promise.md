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

LoggerJS 1.0. Every `@loggerjs/*` package moves to 1.0.0. Semantic versioning covers Stable exports: no removals, renames, or signature breaks within a major. Compatible exports and Experimental packages change only after a deprecation in an earlier minor. The support windows in GOVERNANCE and SECURITY now apply to every package: the previous minor gets security and data-loss fixes for six months after the next minor ships, the last 0.x minor gets security fixes for three months, and every Node line and browser baseline a major ships with stays supported for that whole major.
