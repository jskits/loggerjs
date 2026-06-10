# API Report: @loggerjs/otel

Generated from `packages/otel/dist/**/*.d.ts`.
Update with `pnpm build && pnpm api:report` after intentional public API changes.

## index.d.ts

```ts
export * from "./severity.js";
export * from "./otlp-json.js";
export * from "./transport.js";
export * from "./trace.js";
export * from "./log-bridge.js";
```

## log-bridge.d.ts

```ts
import { type LogEvent, type LoggerLevel, type Transport } from "@loggerjs/core";
export interface OpenTelemetryLogBridgeRecord {
    timestamp: number;
    observedTimestamp: number;
    severityNumber: number;
    severityText: string;
    body: unknown;
    attributes: Record<string, unknown>;
    traceId?: string;
    spanId?: string;
    traceFlags?: number;
}
export interface OpenTelemetryLoggerLike {
    emit: (record: OpenTelemetryLogBridgeRecord) => void;
}
export interface OpenTelemetryLoggerProviderLike {
    getLogger: (name: string, version?: string, options?: Record<string, unknown>) => OpenTelemetryLoggerLike;
    forceFlush?: () => void | Promise<void>;
    shutdown?: () => void | Promise<void>;
}
export interface OpenTelemetryLogBridgeOptions {
    name?: string;
    minLevel?: LoggerLevel;
    logger?: OpenTelemetryLoggerLike;
    loggerProvider?: OpenTelemetryLoggerProviderLike;
    loggerName?: string;
    loggerVersion?: string;
    loggerOptions?: Record<string, unknown>;
    includeData?: boolean;
    includeContext?: boolean;
    includeTags?: boolean;
    attributes?: Record<string, unknown>;
}
export declare function toOpenTelemetryLogBridgeRecord(event: LogEvent, options?: OpenTelemetryLogBridgeOptions, observedTimestamp?: number): OpenTelemetryLogBridgeRecord;
export declare function openTelemetryLogBridgeTransport(options?: OpenTelemetryLogBridgeOptions): Transport;
```

## otlp-json.d.ts

```ts
import { type Codec, type LogEvent } from "@loggerjs/core";
export type OtlpAnyValue = {
    stringValue: string;
} | {
    boolValue: boolean;
} | {
    intValue: string | number;
} | {
    doubleValue: number;
} | {
    arrayValue: {
        values: OtlpAnyValue[];
    };
} | {
    kvlistValue: {
        values: Array<{
            key: string;
            value: OtlpAnyValue;
        }>;
    };
} | {};
export interface OtlpAttribute {
    key: string;
    value: OtlpAnyValue;
}
export interface OtlpLogRecord {
    timeUnixNano: string;
    observedTimeUnixNano?: string;
    severityNumber: number;
    severityText: string;
    body: OtlpAnyValue;
    attributes?: OtlpAttribute[];
    traceId?: string;
    spanId?: string;
    flags?: number;
}
export interface OtlpResourceOptions {
    resource?: Record<string, unknown>;
    scopeName?: string;
    scopeVersion?: string;
}
export declare function toOtlpLogRecord(event: LogEvent, observedTime?: number): OtlpLogRecord;
export declare function toOtlpJson(events: LogEvent[], options?: OtlpResourceOptions): {
    resourceLogs: {
        resource: {
            attributes: OtlpAttribute[];
        };
        scopeLogs: {
            scope: {
                name: string;
                version: string | undefined;
                attributes: OtlpAttribute[];
            };
            logRecords: OtlpLogRecord[];
        }[];
    }[];
};
export declare function otlpJsonCodec(options?: OtlpResourceOptions): Codec<string>;
```

## severity.d.ts

```ts
import type { EnabledLogLevelName } from "@loggerjs/core";
export declare const otelSeverityNumber: Record<EnabledLogLevelName, number>;
export declare function otelSeverityText(level: EnabledLogLevelName): string;
```

## trace.d.ts

```ts
import type { Processor } from "@loggerjs/core";
export interface OpenTelemetrySpanContextLike {
    traceId: string;
    spanId: string;
    traceFlags?: number;
}
export interface OpenTelemetrySpanLike {
    spanContext: () => OpenTelemetrySpanContextLike;
}
export interface OpenTelemetryApiLike {
    trace?: {
        getActiveSpan?: () => OpenTelemetrySpanLike | undefined;
    };
}
export interface OpenTelemetryTraceProcessorOptions {
    api?: OpenTelemetryApiLike;
}
export declare function openTelemetryTraceProcessor(options?: OpenTelemetryTraceProcessorOptions): Processor;
```

## transport.d.ts

```ts
import { type BatchTransportOptions, type LoggerLevel, type Transport } from "@loggerjs/core";
import { type OtlpResourceOptions } from "./otlp-json.js";
export interface OtlpHttpTransportOptions extends BatchTransportOptions, OtlpResourceOptions {
    url: string;
    name?: string;
    headers?: Record<string, string>;
    minLevel?: LoggerLevel;
    fetchFn?: typeof fetch;
}
export declare function otlpHttpTransport(options: OtlpHttpTransportOptions): Transport;
```
