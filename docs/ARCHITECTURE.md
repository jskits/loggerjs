# loggerjs architecture

## Mental model

```txt
manual API / integrations
        |
        v
  Logger core
        |
        v
  Processor pipeline
        |
        v
  Transport router
        |
        v
  Codec + sink
```

## LogEvent

Every event has a stable envelope:

```ts
interface LogEvent {
  id: string;
  time: number;
  seq: number;
  level: number;
  levelName: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
  logger: string;
  message: string;
  type?: string;
  tags?: Record<string, string | number | boolean | null | undefined>;
  data?: unknown;
  error?: SerializedError;
  context?: Record<string, unknown>;
  trace?: TraceContext;
  source?: LogSource;
}
```

## Processors

Processors are synchronous functions:

```ts
type Processor = (event, context) => LogEvent | false | void;
```

Return `false` to drop an event. Return nothing to keep the same event. Return a new event for copy-on-write transforms.

Recommended built-in processor groups:

- privacy: redaction, PII masking, allowlist projection
- routing: type/tags, namespace normalization
- volume control: sampling, dedupe, minimum-level filters
- correlation: request id, trace id, session id, user-safe id
- normalization: Error, DOMException, HTTP metadata, framework errors

## Transports

A transport can accept one event or a batch:

```ts
interface Transport {
  log?: (event, context) => void | Promise<void>;
  logBatch?: (events, context) => void | Promise<void>;
  flush?: () => void | Promise<void>;
  close?: () => void | Promise<void>;
}
```

Transport responsibilities:

- backpressure and queue policy
- serialization via codec
- network/file/console/write target
- retries, flush, and close
- isolation from the application hot path

## Integrations

Integrations install automatic collection:

```ts
interface Integration {
  name: string;
  setup(logger): void | (() => void);
}
```

Examples:

- browser console capture
- browser `window.error` and `unhandledrejection`
- browser fetch/XHR HTTP error collection
- Node `uncaughtException`, `unhandledRejection`, and `warning`
- framework adapters such as React error boundary, Next.js route handler, Express middleware

## Codecs

A codec owns serialization:

```ts
interface Codec<TPayload = string | Uint8Array> {
  name: string;
  contentType: string;
  encode(input: LogEvent | LogEvent[]): TPayload;
  decode?: (payload: TPayload) => LogEvent | LogEvent[];
}
```

Core codecs:

- `jsonCodec`: fastest for trusted, already JSON-safe events
- `safeJsonCodec`: circular-safe and Error/BigInt aware
- `ndjsonCodec`: stdout/file/log pipeline friendly
- `fastEventJsonCodec`: fixed-shape event encoder
- `msgpackrCodec`: adapter for user-provided msgpackr runtime

## Roadmap

### v0.1

- Core logger API
- Browser HTTP transport
- Node stdout/file/http transport
- Redact/sample/tag/dedupe/trace processors
- Console/error/fetch/XHR/process integrations
- OTLP JSON mapping

### v0.2

- Web Worker transport
- IndexedDB offline queue
- React/Next/Vue integrations
- Express/Fastify/Hono middleware
- Benchmark suite against Pino/Winston/console/JSON.stringify
- Schema-driven codec package

### v0.3

- Transport router by level/type/tag
- Runtime config reloading
- First-party collector server
- Source map error enhancer
- Privacy policy helpers and field allowlist mode
