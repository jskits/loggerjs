# Pretty Output

Pretty output is a developer-experience layer for local consoles and terminals.
It keeps LoggerJS records structured internally, then renders them at the
transport boundary for humans.

Use pretty transports for development, demos, local debugging, Storybook,
browser DevTools, CLIs, and tests that need readable output. Use structured
transports such as `stdoutTransport()`, `fileTransport()`, `browserHttpTransport()`,
OTLP, Loki, or Datadog for production delivery.

## Browser DevTools

Use `prettyConsoleTransport()` from `@loggerjs/pretty` when you want readable
browser console output with inspectable objects:

```ts
import { createLogger } from "@loggerjs/core";
import { prettyConsoleTransport } from "@loggerjs/pretty/transport-console";

const logger = createLogger({
  transports: [
    prettyConsoleTransport({
      browserStyles: "auto",
      mode: "compact",
      includeData: true,
      includeContext: false,
    }),
  ],
});

logger.info("cart updated", { itemCount: 3 });
```

What it does:

- Uses `%c` styles in browsers when `browserStyles: "auto"` detects DevTools.
- Passes `data`, `error`, and other details as separate console arguments so
  objects stay expandable.
- Writes through LoggerJS' unpatched console registry, so it can run beside
  `captureConsoleIntegration()` without loops.
- Filters records captured from `captureConsoleIntegration()` by default.

## Node Terminal

Use `prettyStdoutTransport()` or `prettyStderrTransport()` for local terminal
output:

```ts
import { createLogger } from "@loggerjs/core";
import { prettyStdoutTransport } from "@loggerjs/pretty/transport-stream";

const logger = createLogger({
  transports: [
    prettyStdoutTransport({
      colors: "auto",
      mode: "expanded",
      minLevel: "debug",
    }),
  ],
});
```

What it does:

- Emits ANSI colors when the target stream is a TTY.
- Honors `NO_COLOR` and `FORCE_COLOR`.
- Supports `minLevel`.
- `flush()` waits for `drain` when the stream reports backpressure.
- Does not end `process.stdout` / `process.stderr` on `close()` unless
  `endOnClose: true` is set.

## Shared Formatter

Custom display transports can use the formatter directly:

```ts
import { formatPrettyEvent } from "@loggerjs/pretty/formatter";

const rendered = formatPrettyEvent(event, {
  colors: "never",
  mode: "expanded",
  includeTrace: true,
});

console.log(rendered.text);
```

`formatPrettyEvent()` returns:

- `text` for plain output.
- `ansiText` for terminal output when `colors: "always"` is used.
- `browserArgs` for `console.*(...args)` with browser `%c` styles.
- `details` with raw values and serialized text for custom sinks.

## Option Guidance

| Option                                                            | Use                                                                        |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `mode: "compact"`                                                 | One-line local output. Good for browser consoles and busy CLIs.            |
| `mode: "expanded"`                                                | Multi-line output with one detail per line. Good for local Node debugging. |
| `colors: "auto"`                                                  | Terminal default: use ANSI only when the stream looks interactive.         |
| `browserStyles: "auto"`                                           | Browser default: use CSS console styles only in browser-like runtimes.     |
| `includeData` / `includeError`                                    | On by default because pretty output is for humans.                         |
| `includeContext` / `includeTrace` / `includeSource` / `includeId` | Off by default to keep output readable; enable when debugging correlation. |

## Production Boundary

Pretty transports are intentionally not durability transports. They do not batch,
retry, persist, or speak a collector wire protocol. For production Node services,
prefer:

```ts
import { stdoutTransport } from "@loggerjs/node";

stdoutTransport(); // NDJSON for collectors
```

For local development, it is normal to run both:

```ts
import { createLogger } from "@loggerjs/core";
import { stdoutTransport } from "@loggerjs/node";
import { prettyStderrTransport } from "@loggerjs/pretty";

const logger = createLogger({
  transports: [
    stdoutTransport({ minLevel: "info" }),
    prettyStderrTransport({ minLevel: "debug", colors: "auto" }),
  ],
});
```
