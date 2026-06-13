# @loggerjs/sentry

> Forward LoggerJS logs to Sentry as structured logs, breadcrumbs, and captured exceptions/messages.

[![npm](https://img.shields.io/npm/v/@loggerjs/sentry.svg)](https://www.npmjs.com/package/@loggerjs/sentry)
[![license](https://img.shields.io/npm/l/@loggerjs/sentry)](../../LICENSE)

A Sentry adapter transport for [LoggerJS](../../README.md). It uses the Sentry SDK your app already initialized — no second SDK is bundled — and can emit structured logs, attach breadcrumbs, and capture errors and messages as Sentry events.

## Install

```bash
npm install @loggerjs/sentry
```

`@sentry/core` (`>=8 <11`) is a **peer dependency**. Pass the Sentry object (browser or Node SDK) your application uses.

## Usage

```ts
import { createLogger } from "@loggerjs/core";
import { sentryTransport } from "@loggerjs/sentry";
import * as Sentry from "@sentry/browser";

const logger = createLogger({
  category: ["web"],
  transports: [
    sentryTransport({
      sentry: Sentry,
      structuredLogs: true, // send structured logs
      breadcrumbs: true,    // add each log as a breadcrumb
      captureErrors: true,  // capture events carrying an Error as exceptions
    }),
  ],
});
```

## Options

| Option | Description |
| --- | --- |
| `sentry` | **Required.** The initialized Sentry SDK object. |
| `structuredLogs` | Send events as Sentry structured logs. |
| `breadcrumbs` | Add each log as a breadcrumb for later events. |
| `captureErrors` | Capture events that carry an `Error` as Sentry exceptions. |
| `captureMessages` | Capture non-error events as Sentry messages. |
| `eventLevel` | Minimum level promoted to a captured Sentry event. |
| `minLevel` | Minimum level this transport accepts. |

## Subpath exports

`@loggerjs/sentry/transport`

## Documentation

- [Transports](../../docs/TRANSPORTS.md) · [Operations](../../docs/OPERATIONS.md) · [LoggerJS root README](../../README.md)

## License

[MIT](../../LICENSE) © JS Kits
