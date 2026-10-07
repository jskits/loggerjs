---
"@loggerjs/core": patch
---

With `configure({ shareAcrossCopies: true })`, the copy of `@loggerjs/core` that called `configure()` now builds every registry logger, whichever copy calls `getLogger()`. A diagnostics sink installed through that copy with `setLoggerDiagnosticSink()` therefore sees the registry loggers of libraries that load another copy, such as a CJS library in an ESM app. The sink itself stays per copy, so bundles that never install one still drop the diagnostics code. A configuration written by an older copy falls back to the reading copy's own logger.
