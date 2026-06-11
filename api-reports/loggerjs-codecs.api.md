# API Report: @loggerjs/codecs

Generated from `packages/codecs/dist/**/*.d.ts`.
Update with `pnpm build && pnpm api:report` after intentional public API changes.

## fast-event-json.d.ts

```ts
import { type Codec, type SafeStringifyOptions } from "@loggerjs/core";
/**
 * Without any option set, encode runs on a native `JSON.stringify` fast path: nested
 * `Error` values serialize as `{}` and circular or BigInt payloads trigger a safe
 * re-encode of the whole input (circular refs become "[Circular]", BigInt becomes a
 * string). Setting any {@link SafeStringifyOptions} field opts into the safe encoder
 * everywhere, which also preserves `Error` name/message/stack inside data payloads.
 *
 * `includeId`, `includeSeq`, and `includeLevelName` trim the envelope for
 * pino-shaped minimal NDJSON output; turning `includeId` off also skips id
 * computation entirely on the record path.
 */
export interface FastEventJsonCodecOptions extends SafeStringifyOptions {
    includeContext?: boolean;
    includeData?: boolean;
    includeError?: boolean;
    includeTrace?: boolean;
    includeSource?: boolean;
    includeId?: boolean;
    includeSeq?: boolean;
    includeLevelName?: boolean;
}
export declare function fastEventJsonCodec(options?: FastEventJsonCodecOptions): Codec<string>;
```

## index.d.ts

```ts
export * from "@loggerjs/core";
export * from "./fast-event-json.js";
export * from "./msgpackr.js";
export * from "./projector.js";
```

## msgpackr.d.ts

```ts
import { type Codec } from "@loggerjs/core";
import { type Options as MsgpackrOptions } from "msgpackr";
export interface MsgpackRuntime {
    pack: (input: unknown) => Uint8Array;
    unpack: (payload: Uint8Array) => unknown;
}
export type MsgpackrCodecOptions = MsgpackrOptions;
export declare function msgpackrCodec(options?: MsgpackRuntime | MsgpackrCodecOptions): Codec<Uint8Array>;
```

## projector.d.ts

```ts
import { type Codec, type LogEvent } from "@loggerjs/core";
export interface ProjectorCodecOptions<TWire> {
    name: string;
    contentType: string;
    project: (input: LogEvent | LogEvent[]) => TWire;
    serialize: (wire: TWire) => string | Uint8Array;
    parse?: (payload: string | Uint8Array) => TWire;
    unproject?: (wire: TWire) => LogEvent | LogEvent[];
}
export declare function projectorCodec<TWire>(options: ProjectorCodecOptions<TWire>): Codec<string | Uint8Array>;
```
