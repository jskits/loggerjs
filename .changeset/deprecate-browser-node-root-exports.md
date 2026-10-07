---
"@loggerjs/browser": minor
"@loggerjs/node": minor
---

Deprecate the root re-exports of compatible components. In 1.0 the `@loggerjs/browser` and `@loggerjs/node` roots export only the core kernel and their stable components (browser: `browserHttpTransport`, the IndexedDB stores, `offlineFirstTransport`, and the console, error, context, and page-lifecycle integrations; Node: stdout, stderr, file, rotating-file, and HTTP transports, process capture, and AsyncLocalStorage context) and become stable. The other root exports keep working in 0.x and are marked `@deprecated`; import them from their subpaths, for example `captureFetchIntegration` from `@loggerjs/browser/integration-fetch` or `expressIntegration` from `@loggerjs/node/integration-express`. MIGRATION lists the subpath for every export.
