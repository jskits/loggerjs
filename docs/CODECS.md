# Codecs

A codec turns log records or events into bytes (and optionally back). Codecs belong to **transports** — the pipeline keeps values raw so redaction and routing operate on structured data, and each destination chooses its own wire format.

## The Contract

```ts
interface Codec<TPayload = string | Uint8Array> {
  name: string;
  contentType: string;
  encode(input: LogEvent | LogRecord | readonly (LogEvent | LogRecord)[], context?: EncodeContext): TPayload;
  decode?(payload: TPayload): LogEvent | LogEvent[];
}
```

- `encode` accepts single items or batches, events or records. `normalizeCodecInput()` from core projects records to events for codecs that only understand events.
- `decode` is optional; built-in codecs implement it with `JSON.parse` for symmetric round trips of their own output.

## Built-in Codecs

| Codec | Package | Behavior |
| --- | --- | --- |
| `jsonCodec()` | core | Bare `JSON.stringify` after input normalization. Fast, throws on circular/BigInt — pick it only when payloads are guaranteed clean. |
| `safeJsonCodec(options)` | core | Full safe normalization every time: circular → `"[Circular]"`, BigInt → string, Error → `{name, message, stack}`, depth/array/key truncation, Map/Set conversion. Default codec of `consoleTransport({ pretty: false })`. |
| `ndjsonCodec(options)` | core | One JSON object per line. **Fast-by-default contract** (below). Default codec of the Node stdout/file transports. |
| `fastEventJsonCodec(options)` | `@loggerjs/codecs` | The performance codec: native fast path, fragment caches (level, logger, tags, time), scan-based string escaping, flat-data direct writer, lean envelope options. |
| `msgpackrCodec(options?)` | `@loggerjs/codecs` | Built-in MessagePack codec backed by `msgpackr`; returns `Uint8Array`. Passing `{ pack, unpack }` is still supported for custom runtimes. |
| `projectorCodec(options)` | `@loggerjs/codecs` | Generic project → serialize (→ parse → unproject) adapter for custom wire schemas. |
| `otlpJsonCodec(options)` | `@loggerjs/otel` | OTLP/HTTP JSON log payloads with resource attributes. |

## The Fast-by-Default Contract

`ndjsonCodec()` and `fastEventJsonCodec()` share one documented behavior model:

- **No options set** — encode runs on a native fast path. Output matches native `JSON.stringify` semantics: nested raw `Error` values in data serialize as `{}`, no depth truncation. Inputs that make native stringify *throw* (circular references, BigInt) are transparently re-encoded with the safe stringifier instead — a log line is never lost to encoding, and each fallback increments the `codec.fallback` meta counter.
- **Any `SafeStringifyOptions` field set** (`maxDepth`, `maxArrayLength`, `maxObjectKeys`, `includeStack`, `stable`, `space`) — the codec opts into full safe normalization for every item, which also preserves `Error` name/message/stack inside data payloads.

Choose explicitly: native-fast with throw-protection, or fully normalized. `safeJsonCodec` remains always-safe.

## Lean Envelope Options

`fastEventJsonCodec` can trim the envelope for minimal NDJSON output:

```ts
fastEventJsonCodec({
  includeId: false,        // also skips id computation entirely on the record path
  includeSeq: false,
  includeLevelName: false,
  // includeData / includeError / includeContext / includeTrace / includeSource
})
```

With the three header flags off, output is pino-shaped: `{"time":...,"level":30,"logger":"api","message":"...","data":{...}}`. This is the configuration behind the headline benchmark numbers in [BENCHMARKS.md](BENCHMARKS.md).

## Records, Events, and IDs

Encoding raw `LogRecord`s (the fast path) has one semantic difference from encoding events: records carry no id, so the codec stamps `defaultRecordId(record, levelName)` — a `time36-seq36-levelName` string identical to what `recordToEvent()` would assign. Consequences:

- With the default id factory, record-encoded and event-encoded output are identical.
- A custom `idFactory` on the logger is **bypassed** by record-direct encoding. If custom ids matter, have your transport convert via `context.toEvent(record)` (memoized, id factory applied) instead of encoding the record directly.

## Writing a Custom Codec

```ts
import { normalizeCodecInput, type Codec } from "@loggerjs/core";

export function csvCodec(): Codec<string> {
  return {
    name: "csv",
    contentType: "text/csv",
    encode(input) {
      const events = normalizeCodecInput(input);
      const list = Array.isArray(events) ? events : [events];
      return list
        .map((e) => `${e.time},${e.levelName},${JSON.stringify(e.logger)},${JSON.stringify(e.message)}`)
        .join("\n");
    },
  };
}
```

Guidelines:

- **Never throw out of `encode`.** Wrap risky paths and fall back to `safeJsonStringify` from core; count fallbacks with `incrementLoggerMetaCounter("codec.fallback")`. A throwing codec turns into a transport failure and, inside a batch transport, a poison batch that burns retries.
- Use `normalizeCodecInput()` unless you deliberately implement a record fast path.
- For binary formats return `Uint8Array` and set an accurate `contentType` — HTTP transports send it.
- Implement `decode` only when symmetric round trips are part of your feature (replay, local query); it is not required for delivery.
