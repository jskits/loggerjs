# API Report: @loggerjs/loki

Generated from `packages/loki/dist/**/*.d.ts`.
Update with `pnpm build && pnpm api:report` after intentional public API changes.

## index.d.ts

```ts
import { type LogEvent, type LoggerLevel, type Transport } from "@loggerjs/core";
export interface LokiTransportOptions {
    url: string;
    name?: string;
    minLevel?: LoggerLevel;
    headers?: Record<string, string>;
    labels?: Record<string, string | number | boolean | null | undefined>;
    labelTags?: readonly string[];
    defaultLabels?: boolean;
    structuredMetadata?: boolean;
    tenantId?: string;
    line?: (event: LogEvent) => string;
    fetchFn?: typeof fetch;
}
export interface LokiPushPayload {
    streams: Array<{
        stream: Record<string, string>;
        values: Array<[string, string] | [string, string, Record<string, unknown>]>;
    }>;
}
export declare function lokiTransport(options: LokiTransportOptions): Transport;
```
