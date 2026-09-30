---
"@loggerjs/browser": patch
"@loggerjs/cloudwatch": patch
"@loggerjs/codecs": patch
"@loggerjs/core": patch
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

Declare `engines.node: ">=20.19.0"`, the oldest Node release the packed packages are smoke-tested on in CI. Package managers can now warn when LoggerJS is installed on an older Node.
