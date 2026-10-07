---
"@loggerjs/core": minor
---

Add the `@loggerjs/core/diagnostics`, `@loggerjs/core/integration-api`, `@loggerjs/core/event-route`, and `@loggerjs/core/codec-prepared` subpath entries. Together with the existing `semantic-events`, `codec-metrics`, `transport-test`, `trace-propagation`, and `payload-transforms` subpaths, every module that leaves the `@loggerjs/core` root in 1.0 can now be imported from its own subpath.
