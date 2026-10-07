---
"@loggerjs/core": minor
---

Deprecate the `@loggerjs/core` root exports of modules that leave the root in 1.0. They keep working in 0.x and are marked `@deprecated`, so editors flag them; import them from their subpaths instead:

- `@loggerjs/core/trace-propagation`: `parseTraceparent`, `formatTraceparent`, `parseBaggage`, `formatBaggage`, `traceContextFromHeaders`, `traceContextToHeaders`
- `@loggerjs/core/semantic-events`: `semanticEvents` and the `Semantic*Payload` types
- `@loggerjs/core/payload-transforms`: `applyPayloadTransforms`, `composePayloadTransforms`, `encryptionPayloadTransform`, `encodedPayloadToUint8Array`
- `@loggerjs/core/diagnostics`: `setLoggerDiagnosticSink` and the diagnostic helpers
- `@loggerjs/core/integration-api`: `createIntegrationSetupContext`, `getUnpatchedRegistry`, `registerUnpatchedDefaults`, `onceTeardown`
- `@loggerjs/core/event-route`: `withLogEventRoute`, `getLogEventRoute`, `LOGGERJS_ROUTE`
- `@loggerjs/core/codec-metrics`: `metricsCodec`
- `@loggerjs/core/codec-prepared`: `createPreparedRecordEncoder`
- `@loggerjs/core/transport-test`: `testTransport` and its option types

These subpaths are now classified Compatible Public Surface; the root kernel stays stable.
