import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const iterations = Number.parseInt(process.env.BENCH_BROWSER_ITERATIONS ?? "50000", 10);
const indexedDbIterations = Number.parseInt(process.env.BENCH_BROWSER_IDB_ITERATIONS ?? "2000", 10);

const chromeCandidates = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

function which(command) {
  const result = spawnSync("which", [command], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

function findChrome() {
  for (const candidate of chromeCandidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return which("google-chrome") ?? which("chromium") ?? which("chromium-browser");
}

function contentType(path) {
  if (path.endsWith(".js")) return "text/javascript";
  if (path.endsWith(".map")) return "application/json";
  if (path.endsWith(".html")) return "text/html";
  return "text/plain";
}

function safeRepoPath(urlPath) {
  const normalized = normalize(urlPath.replace(/^\/+/, ""));
  if (normalized.startsWith("..")) return undefined;
  if (!normalized.startsWith("packages/")) return undefined;
  const absolutePath = join(repoRoot, normalized);
  return existsSync(absolutePath) ? absolutePath : undefined;
}

function waitForExit(childProcess, timeoutMs = 1_000) {
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timeoutId = setTimeout(resolve, timeoutMs);
    childProcess.once("exit", () => {
      clearTimeout(timeoutId);
      resolve();
    });
  });
}

const page = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <script type="importmap">
      {
        "imports": {
          "@loggerjs/core": "/packages/core/dist/index.js",
          "@loggerjs/browser": "/packages/browser/dist/index.js",
          "@loggerjs/codecs": "/packages/codecs/dist/index.js",
          "msgpackr": "/packages/codecs/node_modules/msgpackr/index.js"
        }
      }
    </script>
  </head>
  <body>
    <script type="module">
      import {
        createLogger,
        browserHttpTransport,
        indexedDbBrowserHttpOfflineQueue,
        indexedDbTransport,
        jsonCodec,
      } from "@loggerjs/browser";
      import { fastEventJsonCodec } from "@loggerjs/codecs";

      const iterations = ${JSON.stringify(iterations)};
      const indexedDbIterations = ${JSON.stringify(indexedDbIterations)};
      const warmupIterations = Math.min(5000, Math.max(500, Math.floor(iterations / 10)));
      let blackhole = 0;

      function consume(value) {
        if (typeof value === "string") blackhole ^= value.length;
        else if (value instanceof Uint8Array) blackhole ^= value.byteLength;
      }

      function measure(name, fn, count = iterations) {
        for (let index = 0; index < warmupIterations; index++) consume(fn(index));
        const start = performance.now();
        for (let index = 0; index < count; index++) consume(fn(index));
        const elapsedMs = performance.now() - start;
        return {
          name,
          iterations: count,
          elapsedMs,
          opsPerSecond: count / (elapsedMs / 1000),
          nsPerOp: (elapsedMs * 1000000) / count,
        };
      }

      async function measureAsync(name, fn, count = indexedDbIterations) {
        const start = performance.now();
        for (let index = 0; index < count; index++) consume(await fn(index));
        const elapsedMs = performance.now() - start;
        return {
          name,
          iterations: count,
          elapsedMs,
          opsPerSecond: count / (elapsedMs / 1000),
          nsPerOp: (elapsedMs * 1000000) / count,
        };
      }

      function deleteDatabase(name) {
        return new Promise((resolve) => {
          const request = indexedDB.deleteDatabase(name);
          request.addEventListener("success", () => resolve(), { once: true });
          request.addEventListener("error", () => resolve(), { once: true });
          request.addEventListener("blocked", () => resolve(), { once: true });
        });
      }

      function event(index, prefix = "browser") {
        return {
          id: prefix + "-" + index,
          time: 1700000000000 + index,
          seq: index,
          level: 30,
          levelName: "info",
          logger: "bench.browser",
          message: "browser event",
          data: { index, ok: true },
        };
      }

      function offlineEntry(index) {
        return {
          id: "offline-" + index,
          url: "/logs",
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(event(index, "offline")),
          keepalive: true,
          createdAt: 1700000000000 + index,
        };
      }

      const noTransportLogger = createLogger({ level: "debug", transports: [] });
      const httpTransport = browserHttpTransport({
        url: "/logs",
        fetchFn: async () => ({ ok: true, status: 200 }),
        flushIntervalMs: 60000,
        maxBatchSize: 1024,
      });
      const httpLogger = createLogger({ level: "debug", transports: [httpTransport] });
      const sampleBatch = Array.from({ length: 16 }, (_, index) => ({
        id: "browser-" + index,
        time: 1700000000000,
        seq: index,
        level: 30,
        levelName: "info",
        logger: "bench.browser",
        message: "browser event",
        data: { index, ok: true },
      }));
      const json = jsonCodec();
      const fastJson = fastEventJsonCodec();
      const runId = String(Date.now()) + "-" + Math.random().toString(36).slice(2);
      const indexedDbEnqueue = indexedDbTransport({
        dbName: "loggerjs-bench-enqueue-" + runId,
        storeName: "logs",
        batchSize: iterations + 1,
        flushIntervalMs: 60000,
        flushOnPageHide: false,
        maxBufferSize: iterations + 1024,
        maxEntries: iterations + indexedDbIterations + 1024,
        codec: json,
      });
      const indexedDbEnqueueLogger = createLogger({ level: "debug", transports: [indexedDbEnqueue] });
      const indexedDbFlush = indexedDbTransport({
        dbName: "loggerjs-bench-flush-" + runId,
        storeName: "logs",
        batchSize: indexedDbIterations + 1,
        flushIntervalMs: 60000,
        flushOnPageHide: false,
        maxBufferSize: indexedDbIterations + 1024,
        maxEntries: indexedDbIterations + 1024,
        codec: json,
      });
      const indexedDbFlushLogger = createLogger({ level: "debug", transports: [indexedDbFlush] });
      const offlineQueue = indexedDbBrowserHttpOfflineQueue({
        dbName: "loggerjs-bench-offline-" + runId,
        storeName: "http-offline",
        maxEntries: indexedDbIterations + 1024,
      });

      const rows = [];
      try {
        rows.push(measure("browser logger no transports", (index) => noTransportLogger.info("browser event", { index })));
        rows.push(measure("browser http enqueue", (index) => httpLogger.info("browser event", { index })));
        rows.push(
          measure("browser indexeddb transport enqueue", (index) =>
            indexedDbEnqueueLogger.info("browser idb event", { index }),
          ),
        );
        await indexedDbEnqueue.clear();
        rows.push(measure("browser json encode batch", () => json.encode(sampleBatch), Math.max(5000, Math.floor(iterations / 5))));
        rows.push(measure("browser fast-json encode batch", () => fastJson.encode(sampleBatch), Math.max(5000, Math.floor(iterations / 5))));
        await indexedDbFlush.clear();
        rows.push(
          await measureAsync("browser indexeddb transport flush", async (index) => {
            indexedDbFlushLogger.info("browser idb flush", { index });
            if (index + 1 >= indexedDbIterations) await indexedDbFlushLogger.flush();
          }),
        );
        await indexedDbFlush.clear();
        await offlineQueue.clear();
        rows.push(
          await measureAsync("browser indexeddb offline queue enqueue", async (index) => {
            await offlineQueue.enqueue(offlineEntry(index));
          }),
        );
        blackhole ^= await offlineQueue.size();
        await offlineQueue.clear();
        await httpLogger.flush();
      } finally {
        await Promise.allSettled([
          indexedDbEnqueue.close?.(),
          indexedDbFlush.close?.(),
          Promise.resolve().then(() => offlineQueue.close()),
        ]);
        await Promise.allSettled([
          deleteDatabase("loggerjs-bench-enqueue-" + runId),
          deleteDatabase("loggerjs-bench-flush-" + runId),
          deleteDatabase("loggerjs-bench-offline-" + runId),
        ]);
      }

      await fetch("/result", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ iterations, indexedDbIterations, rows, blackhole }),
      });
    </script>
  </body>
</html>`;

const chrome = findChrome();
if (!chrome) {
  console.warn("Skipping browser benchmark: Chrome was not found. Set CHROME_BIN to run it.");
  process.exit(0);
}

let resolveResult;
let rejectResult;
const resultPromise = new Promise((resolve, reject) => {
  resolveResult = resolve;
  rejectResult = reject;
});

const server = createServer((request, response) => {
  if (!request.url) {
    response.writeHead(404).end();
    return;
  }

  const url = new URL(request.url, "http://localhost");
  if (request.method === "GET" && url.pathname === "/") {
    response.writeHead(200, { "content-type": "text/html" }).end(page);
    return;
  }

  if (request.method === "GET") {
    const path = safeRepoPath(url.pathname);
    if (!path) {
      response.writeHead(404).end("not found");
      return;
    }
    response.writeHead(200, { "content-type": contentType(path) }).end(readFileSync(path));
    return;
  }

  if (request.method === "POST" && url.pathname === "/result") {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      response.writeHead(204).end();
      resolveResult(JSON.parse(body));
    });
    return;
  }

  response.writeHead(404).end();
});

server.on("error", rejectResult);
server.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));

const { port } = server.address();
const userDataDir = mkdtempSync(join(tmpdir(), "loggerjs-browser-bench-"));
const chromeProcess = spawn(
  chrome,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    `--user-data-dir=${userDataDir}`,
    `http://127.0.0.1:${port}/`,
  ],
  { stdio: "ignore" },
);

const timeout = setTimeout(() => {
  rejectResult(new Error("Browser benchmark timed out"));
}, 30_000);

try {
  const result = await resultPromise;
  clearTimeout(timeout);
  console.log(`Browser benchmark iterations: ${result.iterations}`);
  console.log(`Browser IndexedDB iterations: ${result.indexedDbIterations}`);
  console.log("| Scenario | ops/sec | ns/op | iterations |");
  console.log("| --- | ---: | ---: | ---: |");
  for (const row of result.rows) {
    console.log(
      `| ${row.name} | ${Math.round(row.opsPerSecond).toLocaleString("en-US")} | ${Math.round(row.nsPerOp).toLocaleString("en-US")} | ${row.iterations.toLocaleString("en-US")} |`,
    );
  }
  if (result.blackhole === 42) console.log("blackhole", result.blackhole);
} finally {
  chromeProcess.kill("SIGTERM");
  await waitForExit(chromeProcess);
  server.close();
  rmSync(userDataDir, { force: true, maxRetries: 5, recursive: true, retryDelay: 100 });
}
