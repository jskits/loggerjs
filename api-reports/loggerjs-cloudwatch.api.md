# API Report: @loggerjs/cloudwatch

Generated from `packages/cloudwatch/dist/**/*.d.ts`.
Update with `pnpm build && pnpm api:report` after intentional public API changes.

## index.d.ts

```ts
import { type LogEvent, type LoggerLevel, type Transport } from "@loggerjs/core";
export interface AwsCredentials {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
}
export type AwsCredentialsProvider = () => AwsCredentials | Promise<AwsCredentials>;
export interface AwsV4SignRequestOptions {
    method: string;
    url: string;
    region: string;
    service: string;
    headers: Record<string, string>;
    body: string;
    credentials: AwsCredentials;
    now?: Date;
}
export interface CloudWatchLogEvent {
    timestamp: number;
    message: string;
}
export interface CloudWatchPutLogEventsRequest {
    logGroupName: string;
    logStreamName: string;
    logEvents: CloudWatchLogEvent[];
}
export interface CloudWatchLogsTransportOptions {
    region: string;
    logGroupName: string;
    logStreamName: string | ((event: LogEvent) => string);
    name?: string;
    minLevel?: LoggerLevel;
    endpoint?: string;
    headers?: Record<string, string>;
    credentials?: AwsCredentials | AwsCredentialsProvider;
    signer?: (request: AwsV4SignRequestOptions) => Record<string, string> | Promise<Record<string, string>>;
    message?: (event: LogEvent) => string;
    now?: () => Date;
    fetchFn?: typeof fetch;
}
export declare function signAwsV4Request(options: AwsV4SignRequestOptions): Promise<Record<string, string>>;
export declare function toCloudWatchLogEvent(event: LogEvent, message?: (event: LogEvent) => string): CloudWatchLogEvent;
export declare function createCloudWatchPutLogEventsRequest(events: readonly LogEvent[], options: Pick<CloudWatchLogsTransportOptions, "logGroupName" | "logStreamName" | "message">): CloudWatchPutLogEventsRequest[];
export declare function cloudWatchLogsTransport(options: CloudWatchLogsTransportOptions): Transport;
```
