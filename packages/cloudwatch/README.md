# @loggerjs/cloudwatch

> Deliver LoggerJS logs to Amazon CloudWatch Logs with built-in SigV4 signing.

[![npm](https://img.shields.io/npm/v/@loggerjs/cloudwatch.svg)](https://www.npmjs.com/package/@loggerjs/cloudwatch)
[![license](https://img.shields.io/npm/l/@loggerjs/cloudwatch)](../../LICENSE)

An Amazon CloudWatch Logs (`PutLogEvents`) transport for [LoggerJS](../../README.md). It signs requests with **built-in AWS SigV4** and calls the API directly over `fetch` — no `aws-sdk` / `@aws-sdk/*` packages required.

## Install

```bash
npm install @loggerjs/cloudwatch
```

## Usage

```ts
import { createLogger } from "@loggerjs/core";
import { cloudWatchLogsTransport } from "@loggerjs/cloudwatch";

const logger = createLogger({
  category: ["api"],
  transports: [
    cloudWatchLogsTransport({
      region: "us-east-1",
      logGroupName: "/aws/app/loggerjs",
      logStreamName: "api",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        sessionToken: process.env.AWS_SESSION_TOKEN,
      },
    }),
  ],
});
```

## Options

| Option | Description |
| --- | --- |
| `region` | **Required.** AWS region. |
| `logGroupName` | **Required.** Target log group. |
| `logStreamName` | **Required.** Log stream — a fixed string or a function of the event. |
| `credentials` | **Required.** Static AWS credentials or a provider function (supports `sessionToken`). |
| `signer` | Override the built-in SigV4 signer (e.g. to use an external credential chain). |
| `endpoint` | Custom endpoint (VPC endpoints, local emulators). |
| `message`, `now` | Derive the message and timestamp per event. |
| `headers`, `fetchFn` | Custom headers and `fetch` implementation. |

The transport supports `logBatch` delivery. For queueing, retry, backoff, or circuit-breaker behavior, wrap it with `batchTransport()` / `retryTransport()` from `@loggerjs/core` (see [TRANSPORTS.md](../../docs/TRANSPORTS.md)). The helpers `createCloudWatchPutLogEventsRequest` and `toCloudWatchLogEvent` are exported for custom pipelines.

## Subpath exports

`@loggerjs/cloudwatch/transport`

## Documentation

- [Transports](../../docs/TRANSPORTS.md) · [LoggerJS root README](../../README.md)

## License

[MIT](../../LICENSE) © JS Kits
