# @loggerjs/pretty

Pretty display transports and formatters for LoggerJS.

This package is for local developer experience: browser DevTools, Node
terminals, and custom debug sinks. Production delivery should still prefer
structured transports such as `stdoutTransport()`, `fileTransport()`,
`browserHttpTransport()`, OTLP, Loki, Datadog, or another machine-readable
destination.

## Browser / Console

```ts
import { createLogger } from "@loggerjs/core";
import { prettyConsoleTransport } from "@loggerjs/pretty";

const logger = createLogger({
  transports: [
    prettyConsoleTransport({
      browserStyles: "auto",
      mode: "compact",
      includeData: true,
    }),
  ],
});
```

`prettyConsoleTransport()` writes through the unpatched console registry, so it
can run beside `captureConsoleIntegration()` without feedback loops.

## Formatter

```ts
import { formatPrettyEvent } from "@loggerjs/pretty/formatter";

const rendered = formatPrettyEvent(event, { mode: "expanded", colors: "never" });
console.log(rendered.text);
```

The formatter returns plain text, ANSI text, browser console arguments, and raw
detail values so custom transports can preserve inspectable objects.
