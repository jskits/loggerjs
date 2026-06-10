# API Report: @loggerjs/sentry

Generated from `packages/sentry/dist/**/*.d.ts`.
Update with `pnpm build && pnpm api:report` after intentional public API changes.

## index.d.ts

```ts
import { type LoggerLevel, type Transport } from "@loggerjs/core";
export type SentrySeverity = "debug" | "error" | "fatal" | "info" | "log" | "warning";
export interface SentryLoggerLike {
    trace?: (message: string, attributes?: Record<string, unknown>) => void;
    debug?: (message: string, attributes?: Record<string, unknown>) => void;
    info?: (message: string, attributes?: Record<string, unknown>) => void;
    warn?: (message: string, attributes?: Record<string, unknown>) => void;
    error?: (message: string, attributes?: Record<string, unknown>) => void;
    fatal?: (message: string, attributes?: Record<string, unknown>) => void;
}
export interface SentryLike {
    logger?: SentryLoggerLike;
    addBreadcrumb?: (breadcrumb: {
        type?: string;
        category?: string;
        level?: SentrySeverity;
        message?: string;
        data?: Record<string, unknown>;
    }) => void;
    captureException?: (exception: unknown, context?: Record<string, unknown>) => string | undefined;
    captureMessage?: (message: string, context?: Record<string, unknown>) => string | undefined;
}
export interface SentryTransportOptions {
    sentry: SentryLike;
    name?: string;
    minLevel?: LoggerLevel;
    structuredLogs?: boolean;
    breadcrumbs?: boolean;
    captureErrors?: boolean;
    captureMessages?: boolean;
    eventLevel?: LoggerLevel;
}
export declare function sentryTransport(options: SentryTransportOptions): Transport;
```
