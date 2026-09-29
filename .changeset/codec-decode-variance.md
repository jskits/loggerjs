---
"@loggerjs/core": patch
---

Let string codecs be passed to transports under strict TypeScript. `Codec.decode` was declared as a function-typed property, which made its payload parameter contravariant, so `stdoutTransport({ codec: ndjsonCodec() })` or `nodeHttpTransport({ codec: fastEventJsonCodec() })` failed to compile because `Codec<string>` was not assignable to `Codec<string | Uint8Array>`. `decode` is now declared with method syntax.
