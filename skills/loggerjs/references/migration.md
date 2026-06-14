# Migration

Migrate in slices. Keep existing call-site behavior working first, then improve structure.

## From `console`

1. Add a local logger module.
2. Replace new or touched `console.log`, `console.warn`, and `console.error` calls with `logger.info`, `logger.warn`, and `logger.error`.
3. For broad capture, add console integration with a narrow level set such as `["warn", "error"]`.
4. Keep debug/info console capture off by default in production unless sampled.

Example:

```ts
logger.info("order created", { orderId });
logger.error(error, "payment failed", { orderId });
```

## From pino

Map these first:

| pino concept | LoggerJS direction |
| --- | --- |
| `level` | `level` in `createLogger()` |
| bindings/base fields | `tags`, context provider, or local wrapper |
| serializers | processor or middleware |
| destination/transport | LoggerJS transport |
| `child()` | separate named/category logger or wrapper adding tags/context |
| `flush()` | `await logger.flush()` |

Preserve the existing wrapper API if many call sites use pino-specific argument ordering. Replace internals first, then gradually convert call sites to structured LoggerJS calls.

## From winston

Map these first:

| winston concept | LoggerJS direction |
| --- | --- |
| format pipeline | processors/middleware plus transport-owned codec |
| transports array | LoggerJS transports array |
| exception/rejection handlers | Node process integration |
| defaultMeta | tags or context provider |
| custom format redaction | `redactProcessor()` or privacy processor |

Do not pre-stringify in a format step before LoggerJS. Keep raw fields available for redaction, routing, and transport-specific codecs.

## From loglevel/debug/consola/tslog

- Keep the same public wrapper names if they are widely used.
- Map namespaces to `name` or category tags.
- Replace string-only calls with structured data where the surrounding code already has field values.
- Use `@loggerjs/pretty` for local developer ergonomics when the old logger was mainly human-readable.

## Safe Rollout Pattern

1. Add LoggerJS alongside the old logger.
2. Create an adapter with the old logger's common methods.
3. Send to stdout or a test/memory transport first.
4. Add redaction and production transport.
5. Switch one module or route at a time.
6. Remove the old logger dependency only after call sites and tests no longer import it.
