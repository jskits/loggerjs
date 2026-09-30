---
"@loggerjs/browser": patch
"@loggerjs/cloudwatch": patch
"@loggerjs/codecs": patch
"@loggerjs/database": patch
"@loggerjs/datadog": patch
"@loggerjs/elastic": patch
"@loggerjs/loki": patch
"@loggerjs/node": patch
"@loggerjs/otel": patch
"@loggerjs/pretty": patch
"@loggerjs/processors": patch
"@loggerjs/sentry": patch
---

Depend on `@loggerjs/core` with a caret range instead of an exact version. Upgrading `@loggerjs/core` on its own no longer forces the package manager to install a second copy of core underneath each LoggerJS package.
