# @loggerjs/cloudwatch

Amazon CloudWatch Logs `PutLogEvents` transport for loggerjs.

```ts
import { createLogger } from "@loggerjs/core";
import { cloudWatchLogsTransport } from "@loggerjs/cloudwatch";

const logger = createLogger({
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

Subpaths expose `transport`.
