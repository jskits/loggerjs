import { createLogger, withContext } from "../../packages/core/src/index.ts";
import { prettyConsoleTransport } from "../../packages/pretty/src/index.ts";

const output = document.querySelector("#log-output");
const status = document.querySelector("#status");
const emitSample = document.querySelector("#emit-sample");
const emitError = document.querySelector("#emit-error");
const clear = document.querySelector("#clear");

function detailText(value) {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function appendLine(level, args) {
  const line = document.createElement("article");
  line.className = `log-line ${level}`;

  const text = document.createElement("pre");
  text.className = "line-text";
  text.textContent = String(args[0] ?? "");
  line.append(text);

  for (let i = 1; i < args.length; i += 1) {
    const detail = document.createElement("details");
    const summary = document.createElement("summary");
    const value = document.createElement("pre");
    summary.textContent = `detail ${i}`;
    value.className = "detail-value";
    value.textContent = detailText(args[i]);
    detail.append(summary, value);
    line.append(detail);
  }

  output.append(line);
  output.scrollTop = output.scrollHeight;
}

const pageConsole = {
  debug: (...args) => appendLine("debug", args),
  info: (...args) => appendLine("info", args),
  log: (...args) => appendLine("info", args),
  trace: (...args) => appendLine("trace", args),
  warn: (...args) => appendLine("warn", args),
  error: (...args) => appendLine("error", args),
};

const logger = createLogger({
  name: "pretty-browser-demo",
  level: "trace",
  tags: { app: "pretty-output", runtime: "browser" },
  transports: [
    prettyConsoleTransport({
      name: "page-pretty",
      console: pageConsole,
      browserStyles: false,
      mode: "expanded",
      includeContext: true,
      includeTrace: true,
    }),
    prettyConsoleTransport({
      name: "devtools-pretty",
      browserStyles: "auto",
      mode: "compact",
      includeContext: false,
    }),
  ],
});

function emitSamples() {
  withContext({ requestId: crypto.randomUUID(), view: "browser-demo" }, () => {
    logger.debug("UI control rendered", {
      component: "PrettyOutputDemo",
      controls: ["sample", "error", "clear"],
    });
    logger.info("Checkout page loaded", {
      cartId: "cart_42",
      itemCount: 3,
      currency: "USD",
    });
    logger.warn("API response was slower than budget", {
      route: "/api/checkout/summary",
      durationMs: 842,
      budgetMs: 300,
    });
  });
}

function emitFailure() {
  const error = new Error("Payment authorization failed");
  logger.error("Payment provider rejected the request", {
    provider: "demo-pay",
    code: "card_declined",
    retryable: false,
    error,
  });
}

emitSample.addEventListener("click", emitSamples);
emitError.addEventListener("click", emitFailure);
clear.addEventListener("click", () => {
  output.replaceChildren();
});

status.textContent = "Ready. Click a button, then also check DevTools console.";
emitSamples();
