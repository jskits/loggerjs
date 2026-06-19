# 友好输出

Pretty output 是本地 console 和 terminal 的开发体验层。LoggerJS 在内部仍然保持 records 结构化，只在 transport 边界把它们渲染成人类可读文本。

在开发、demo、本地调试、Storybook、浏览器 DevTools、CLI，以及需要可读输出的测试中使用 pretty transports。生产投递应使用结构化 transports，例如 `stdoutTransport()`、`fileTransport()`、`browserHttpTransport()`、OTLP、Loki 或 Datadog。

## Browser DevTools

当你希望浏览器 console 输出可读，同时对象仍可展开检查时，使用 `@loggerjs/pretty` 的 `prettyConsoleTransport()`：

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

它会：

- 当 `browserStyles: "auto"` 检测到 DevTools 时，在浏览器中使用 `%c` 样式。
- 把 `data`、`error` 和其他 details 作为独立 console 参数传入，让对象保持可展开。
- 通过 LoggerJS 的 unpatched console registry 写出，因此可以和 `captureConsoleIntegration()` 并存而不形成循环。
- 默认过滤来自 `captureConsoleIntegration()` 的 records。

## Node Terminal

本地终端输出使用 `prettyStdoutTransport()` 或 `prettyStderrTransport()`：

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

它会：

- 目标 stream 是 TTY 时输出 ANSI 颜色。
- 尊重 `NO_COLOR` 和 `FORCE_COLOR`。
- 支持 `minLevel`。
- 当 stream 报告 backpressure 时，`flush()` 会等待 `drain`。
- `close()` 默认不会结束 `process.stdout` / `process.stderr`，除非设置 `endOnClose: true`。

## 共享 Formatter

自定义显示 transport 可以直接使用 formatter：

```ts
import { formatPrettyEvent } from "@loggerjs/pretty/formatter";

const rendered = formatPrettyEvent(event, {
  colors: "never",
  mode: "expanded",
  includeTrace: true,
});

console.log(rendered.text);
```

`formatPrettyEvent()` 返回：

- `text`：纯文本输出。
- `ansiText`：`colors: "always"` 时用于终端的文本。
- `browserArgs`：带浏览器 `%c` 样式的 `console.*(...args)` 参数。
- `details`：给自定义 sink 使用的原始值和序列化文本。

## 选项建议

| 选项 | 用法 |
| --- | --- |
| `mode: "compact"` | 单行本地输出。适合浏览器 console 和繁忙 CLI。 |
| `mode: "expanded"` | 多行输出，每个 detail 一行。适合本地 Node 调试。 |
| `colors: "auto"` | 终端默认值：只有 stream 看起来可交互时使用 ANSI。 |
| `browserStyles: "auto"` | 浏览器默认值：只在浏览器类 runtime 中使用 CSS console styles。 |
| `includeData` / `includeError` | 默认开启，因为 pretty output 是给人读的。 |
| `includeContext` / `includeTrace` / `includeSource` / `includeId` | 默认关闭以保持可读；调试关联问题时再开启。 |

## 生产边界

Pretty transports 有意不承担持久化职责。它们不 batch、不 retry、不 persist，也不实现 collector wire protocol。生产 Node 服务优先使用：

```ts
import { stdoutTransport } from "@loggerjs/node";

stdoutTransport(); // NDJSON for collectors
```

本地开发中同时运行结构化输出和 pretty 输出是正常做法：

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
