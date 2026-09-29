---
"@loggerjs/node": patch
---

`captureProcessIntegration()` no longer keeps the process alive after an unhandled promise rejection. Registering an `unhandledRejection` listener disables Node's default crash, so the integration now follows Node's `--unhandled-rejections` mode: by default it captures the rejection as `fatal`, flushes, and exits with code `1`; with `warn`, `none`, or `warn-with-error-code` it only logs (the last also sets `process.exitCode = 1`). Use the new `exitOnUnhandledRejection` option to override.
