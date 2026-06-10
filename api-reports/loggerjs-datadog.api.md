# API Report: @loggerjs/datadog

Generated from `packages/datadog/dist/**/*.d.ts`.
Update with `pnpm build && pnpm api:report` after intentional public API changes.

## index.d.ts

```ts
import { type LogEvent, type LoggerLevel, type Transport } from "@loggerjs/core";
export type DatadogLogStatus = "debug" | "emergency" | "error" | "info" | "notice" | "warning";
export interface DatadogLogsTransportOptions {
    apiKey?: string;
    site?: string;
    url?: string;
    name?: string;
    minLevel?: LoggerLevel;
    headers?: Record<string, string>;
    service?: string;
    source?: string;
    hostname?: string;
    tags?: Record<string, string | number | boolean | null | undefined> | readonly string[];
    eventTagKeys?: readonly string[];
    message?: (event: LogEvent) => string;
    status?: (event: LogEvent) => DatadogLogStatus | string;
    fetchFn?: typeof fetch;
}
export interface DatadogLogItem {
    message: string;
    status: string;
    timestamp: number;
    service?: string;
    ddsource?: string;
    hostname?: string;
    ddtags?: string;
    logger: {
        name: string;
    };
    loggerjs: Record<string, unknown>;
}
export declare function datadogLogsTransport(options?: DatadogLogsTransportOptions): Transport;
```
