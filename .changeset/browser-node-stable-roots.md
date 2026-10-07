---
"@loggerjs/browser": major
"@loggerjs/node": major
---

The `@loggerjs/browser` and `@loggerjs/node` roots now export only the core kernel and their stable components, and both roots are stable. Browser: `browserHttpTransport`, the IndexedDB offline queue and store, `offlineFirstTransport`, and the console, error, context, and page-lifecycle integrations. Node: `stdoutTransport`, `stderrTransport`, `fileTransport`, `rotatingFileTransport`, `nodeHttpTransport`, process capture, and AsyncLocalStorage context. The other root exports, deprecated in 0.7, are removed; import them from their subpaths, which the migration guide lists for every export.
