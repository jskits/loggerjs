# API Report: @loggerjs/elastic

Generated from `packages/elastic/dist/**/*.d.ts`.
Update with `pnpm build && pnpm api:report` after intentional public API changes.

## index.d.ts

```ts
import { type LogEvent, type LoggerLevel, type Transport } from "@loggerjs/core";
export type ElasticIndexSelector = string | ((event: LogEvent) => string);
export type ElasticOpType = "create" | "index";
export interface ElasticTransportOptions {
    url: string;
    name?: string;
    minLevel?: LoggerLevel;
    index?: ElasticIndexSelector;
    opType?: ElasticOpType;
    pipeline?: string | ((event: LogEvent) => string | undefined);
    id?: (event: LogEvent) => string | undefined;
    headers?: Record<string, string>;
    apiKey?: string;
    refresh?: boolean | "wait_for";
    checkBulkErrors?: boolean;
    document?: (event: LogEvent) => Record<string, unknown>;
    fetchFn?: typeof fetch;
}
export interface ElasticBulkActionMetadata {
    _index?: string;
    _id?: string;
    pipeline?: string;
}
export type ElasticBulkAction = {
    create: ElasticBulkActionMetadata;
} | {
    index: ElasticBulkActionMetadata;
};
export declare function toElasticDocument(event: LogEvent): Record<string, unknown>;
export declare function createElasticBulkPayload(events: readonly LogEvent[], options?: Pick<ElasticTransportOptions, "document" | "id" | "index" | "opType" | "pipeline">): string;
export declare function elasticTransport(options: ElasticTransportOptions): Transport;
```
