# API Report: @loggerjs/pretty

Generated from `packages/pretty/dist/**/*.d.ts`.
Update with `pnpm build && pnpm api:report` after intentional public API changes.

## console-transport.d.ts

```ts
import { type LogEvent, type Transport } from "@loggerjs/core";
import { type PrettyFormatterOptions } from "./formatter.js";
export interface PrettyConsoleLike {
    debug?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
    info?: (...args: unknown[]) => void;
    log?: (...args: unknown[]) => void;
    trace?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
}
export interface PrettyConsoleTransportOptions extends PrettyFormatterOptions {
    name?: string;
    browserStyles?: boolean | "auto";
    includeEvent?: boolean;
    console?: PrettyConsoleLike;
    filter?: (event: LogEvent) => boolean;
}
export declare function prettyConsoleTransport(options?: PrettyConsoleTransportOptions): Transport;
```

## formatter.d.ts

```ts
import { type EnabledLogLevelName, type LogEvent } from "@loggerjs/core";
export type PrettyColorMode = "auto" | "always" | "never";
export type PrettyRenderMode = "compact" | "expanded";
export type PrettyTimeFormat = "iso" | "local" | "time" | "none" | ((event: LogEvent) => string);
export interface PrettyLevelStyle {
    label: string;
    ansi: string;
    css: string;
}
export type PrettyLevelStyles = Partial<Record<EnabledLogLevelName, Partial<PrettyLevelStyle>>>;
export interface PrettyFormatterOptions {
    colors?: PrettyColorMode;
    mode?: PrettyRenderMode;
    time?: PrettyTimeFormat;
    includeLogger?: boolean;
    includeType?: boolean;
    includeTags?: boolean;
    includeData?: boolean;
    includeError?: boolean;
    includeContext?: boolean;
    includeTrace?: boolean;
    includeSource?: boolean;
    includeId?: boolean;
    maxInlineLength?: number;
    maxObjectDepth?: number;
    maxObjectKeys?: number;
    levelStyles?: PrettyLevelStyles;
}
export interface PrettyDetail {
    key: string;
    value: unknown;
    text: string;
}
export interface PrettyFormattedEvent {
    text: string;
    ansiText: string;
    browserArgs: unknown[];
    details: PrettyDetail[];
}
export declare function formatPrettyEvent(event: LogEvent, options?: PrettyFormatterOptions): PrettyFormattedEvent;
```

## index.d.ts

```ts
export * from "./formatter.js";
export * from "./console-transport.js";
```
