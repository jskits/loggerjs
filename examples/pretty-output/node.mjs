#!/usr/bin/env node
import { existsSync, mkdirSync, readlinkSync, symlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const coreDist = resolve(repoRoot, "packages/core/dist/index.js");
const prettyDist = resolve(repoRoot, "packages/pretty/dist/index.js");

function requireBuiltFile(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} is missing at ${path}. Build the local packages first.`);
  }
}

function ensurePrettyCanResolveCore() {
  const linkRoot = resolve(repoRoot, "packages/pretty/node_modules/@loggerjs");
  const coreLink = resolve(linkRoot, "core");
  const target = resolve(repoRoot, "packages/core");

  if (existsSync(coreLink)) {
    try {
      if (resolve(dirname(coreLink), readlinkSync(coreLink)) === target) return;
    } catch {
      return;
    }
    return;
  }

  mkdirSync(linkRoot, { recursive: true });
  symlinkSync(target, coreLink, "dir");
}

requireBuiltFile(coreDist, "@loggerjs/core dist");
requireBuiltFile(prettyDist, "@loggerjs/pretty dist");
ensurePrettyCanResolveCore();

const { createLogger, withContext } = await import(pathToFileURL(coreDist).href);
const { formatPrettyEvent, prettyStderrTransport, prettyStdoutTransport } = await import(
  pathToFileURL(prettyDist).href
);

const stdoutLogger = createLogger({
  name: "pretty-node-demo",
  level: "trace",
  tags: { app: "pretty-output", runtime: "node" },
  transports: [
    prettyStdoutTransport({
      colors: "always",
      mode: "compact",
      minLevel: "trace",
      process,
    }),
  ],
});

const stderrLogger = createLogger({
  name: "pretty-node-errors",
  tags: { app: "pretty-output", sink: "stderr" },
  transports: [
    prettyStderrTransport({
      colors: "always",
      mode: "expanded",
      minLevel: "warn",
      process,
      includeContext: true,
      includeTrace: true,
    }),
  ],
});

console.log("\nLoggerJS pretty terminal demo\n");

withContext({ requestId: "req_demo_001", job: "pretty-output" }, () => {
  stdoutLogger.trace("Trace details are visible when minLevel allows them", {
    phase: "bootstrap",
  });
  stdoutLogger.debug("Loaded local dist packages", {
    coreDist,
    prettyDist,
  });
  stdoutLogger.info("Pretty stdout is ready", {
    mode: "compact",
    colors: "always",
  });
  stdoutLogger.warn("This warning is still shown on stdout in this demo", {
    thresholdMs: 250,
    observedMs: 411,
  });
});

withContext({ requestId: "req_demo_002", operation: "checkout" }, () => {
  stderrLogger.warn("Expanded warning on stderr", {
    route: "/api/checkout",
    durationMs: 728,
    budgetMs: 300,
  });
  stderrLogger.error("Expanded error on stderr", {
    provider: "demo-pay",
    retryable: false,
    error: new Error("Payment authorization failed"),
  });
});

const rendered = formatPrettyEvent(
  {
    id: "manual-event",
    time: Date.now(),
    seq: 999,
    level: 30,
    levelName: "info",
    logger: "manual.formatter",
    message: "formatPrettyEvent can power custom display sinks",
    data: { destination: "custom-panel" },
  },
  { colors: "never", mode: "expanded" },
);

console.log("\nShared formatter output:\n");
console.log(rendered.text);
await stdoutLogger.flush();
await stderrLogger.flush();
