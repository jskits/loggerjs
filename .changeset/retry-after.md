---
"@loggerjs/core": minor
"@loggerjs/node": minor
"@loggerjs/browser": minor
"@loggerjs/otel": patch
"@loggerjs/datadog": patch
"@loggerjs/elastic": patch
"@loggerjs/loki": patch
"@loggerjs/cloudwatch": patch
---

Honor `Retry-After`. HTTP transports now throw `httpStatusError()` for non-2xx responses, which carries `status` and, when the response sends `Retry-After` (delay-seconds or an HTTP-date), `retryAfterMs`. `batchTransport()` and `retryTransport()` wait at least that long before the next attempt. A wait longer than `retryMaxDelayMs` ends the current retries instead: `batchTransport()` puts the batch back and sends nothing until the wait ends (counted as `transport.retry.deferred`), and `retryTransport()` gives up with reason `retry-exhausted`, so `flush()` and `close()` are never held by a long server-requested wait. `browserHttpTransport()` pauses scheduled, full-batch, and explicit sends and offline replay until the wait ends; cross-origin collectors must expose `Retry-After` through `Access-Control-Expose-Headers`.

`parseRetryAfter()` and `httpStatusError()` are exported from `@loggerjs/core` for custom HTTP transports. Error messages are unchanged.
