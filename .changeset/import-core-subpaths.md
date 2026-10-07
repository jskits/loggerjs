---
"@loggerjs/browser": patch
"@loggerjs/node": patch
"@loggerjs/pretty": patch
"@loggerjs/processors": patch
---

Import core helpers that leave the `@loggerjs/core` root in 1.0 (payload transforms, trace propagation, diagnostics, integration helpers, and event routes) from their `@loggerjs/core/*` subpaths. These packages now need `@loggerjs/core` 0.7 or later, which their dependency range already requires.
