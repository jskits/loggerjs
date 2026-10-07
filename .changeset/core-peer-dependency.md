---
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

`@loggerjs/core` is now a peer dependency of every other package, so an application installs exactly one copy of core. Install it alongside the packages you use, for example `npm install @loggerjs/core @loggerjs/node`; npm and pnpm add a missing peer automatically, Yarn does not. Every package requires `@loggerjs/core` `^1.0.0`.
