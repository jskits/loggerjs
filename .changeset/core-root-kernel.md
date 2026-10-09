---
"@loggerjs/core": major
---

The `@loggerjs/core` root now exports only the kernel. The 54 exports deprecated in 0.7 are removed from the root: trace propagation, semantic events, payload transforms, diagnostics, integration helpers, event routes, `metricsCodec`, `createPreparedRecordEncoder`, and `testTransport`. Import them from `@loggerjs/core/trace-propagation`, `semantic-events`, `payload-transforms`, `diagnostics`, `integration-api`, `event-route`, `codec-metrics`, `codec-prepared`, and `transport-test`; the migration guide maps every export to its subpath.
