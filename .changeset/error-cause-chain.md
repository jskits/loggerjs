---
"@loggerjs/core": patch
---

Keep `error.cause` chains in logs written with native-JSON codecs. The logger copied an `Error` cause into the serialized error as the `Error` instance itself, and `jsonCodec()`, `ndjsonCodec()` (the default for file, rotating-file, and stdout transports), and `fastEventJsonCodec()` encode with `JSON.stringify`, which turns an `Error` into `{}`, so every cause was written as `"cause":{}`. Error causes are now serialized like the top-level error (name, message, stack, code, and their own cause), with circular causes written as `"[Circular]"` and chains cut off after eight levels.
