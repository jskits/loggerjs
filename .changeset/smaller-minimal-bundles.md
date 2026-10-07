---
"@loggerjs/core": minor
"@loggerjs/node": patch
"@loggerjs/browser": patch
"@loggerjs/database": patch
---

Smaller application bundles. `createLogger()` with `consoleTransport()` drops from about 6.3 KB to 5.5 KB gzip after tree-shaking and minification, `browserHttpTransport()` from 8.5 KB to 7.8 KB, and `stdoutTransport()` from 6.9 KB to 6.2 KB.

- New `safeJsonEncoder()` and `ndjsonEncoder()` in `@loggerjs/core/codec-json` are `safeJsonCodec()` and `ndjsonCodec()` without `decode()`. Transports that only send logs (browser and Node HTTP, WebSocket, worker, database, Node stdout and file) default to them, and `consoleTransport({ pretty: false })` encodes the same way, so apps that never decode leave out the payload validation. Output is unchanged.
- Diagnostics instrumentation is removed entirely from bundles that never install a diagnostics sink, instead of leaving inert checks behind.
