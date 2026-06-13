# @loggerjs/codecs

> High-performance and binary serialization codecs for LoggerJS transports.

[![npm](https://img.shields.io/npm/v/@loggerjs/codecs.svg)](https://www.npmjs.com/package/@loggerjs/codecs)
[![license](https://img.shields.io/npm/l/@loggerjs/codecs)](../../LICENSE)

Optional codecs for [LoggerJS](../../README.md) that go beyond the JSON/NDJSON codecs built into `@loggerjs/core`. **Codecs belong to transports** — the pipeline keeps values raw and each destination owns its serialization, so you can pick a different wire format per transport without touching middleware or processors.

## Install

```bash
npm install @loggerjs/codecs
```

## Usage

```ts
import { fastEventJsonCodec, pinoCompatCodec, projectorCodec } from "@loggerjs/codecs";
import { nodeHttpTransport } from "@loggerjs/node";

// The performance codec for JSON payload transports.
nodeHttpTransport({
  url: "https://collector.example/logs",
  codec: fastEventJsonCodec(),
});

// Drop envelope fields when downstream does not need them.
nodeHttpTransport({
  url: "https://collector.example/logs",
  codec: fastEventJsonCodec({ includeId: false, includeSeq: false, includeLevelName: false }),
});

// Pino-shaped NDJSON for migration paths.
nodeHttpTransport({
  url: "https://collector.example/logs",
  codec: pinoCompatCodec({ base: { pid: process.pid, hostname: "api-1" }, mergeData: true }),
});
```

## Codecs

| Codec | Format | Notes |
| --- | --- | --- |
| `fastEventJsonCodec` | JSON | The performance codec — fragment-cached serialization, fast by default, falls back instead of throwing on circular references. Toggle envelope fields (`includeId`, `includeSeq`, `includeLevelName`) to trade detail for speed. |
| `pinoCompatCodec` / `pinoNdjsonProjector` | NDJSON | Encode-only Pino-shaped migration output with `level`, `time`, optional base fields, `msg`, `err`, and opt-in root data merging with reserved-key protection. |
| `msgpackrCodec` | MessagePack (binary) | Compact binary encoding via [`msgpackr`](https://github.com/kriszyp/msgpackr); ideal for worker, WebSocket, and HTTP transports that accept binary payloads. |
| `projectorCodec` | custom | Build a codec from a `project` step (shape the events) plus a `serialize` step (turn them into the wire payload). |

For line-delimited stdout/file output, use the Node transports' default `ndjsonCodec()` from `@loggerjs/core`; `fastEventJsonCodec()` emits JSON payloads and does not append newlines.

```ts
const idsOnly = projectorCodec({
  name: "ids-only",
  contentType: "application/json",
  project: (events) => events.map((e) => ({ id: e.id, level: e.level, time: e.time })),
  serialize: JSON.stringify,
});
```

> Keep raw, structured values flowing through middleware and processors so redaction works on real data and batching can amortize serialization. Never pre-stringify in the pipeline.

## Documentation

- [Codecs](../../docs/CODECS.md) — the codec contract and fast-by-default safety semantics
- [Performance](../../docs/PERFORMANCE.md) — choosing a codec for the hot path
- [Benchmarks](../../docs/BENCHMARKS.md) · [LoggerJS root README](../../README.md)

## License

[MIT](../../LICENSE) © JS Kits
