// Soak test for the real delivery paths: an async fileTransport, a
// rotatingFileTransport, and a nodeHttpTransport posting to a collector that
// injects 503s, connection resets, and hung requests. Producers write at a
// steady rate for the configured duration, then the logger is closed and the
// run fails on memory growth, a hang, or any event that was neither
// delivered nor reported as dropped.
//
// LOGGERJS_SOAK_DURATION_MS=1800000 node --expose-gc scripts/soak-transports.mjs
import { fork } from "node:child_process";
import {
  closeSync,
  createReadStream,
  existsSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { createInterface } from "node:readline";

const durationMs = Number(process.env.LOGGERJS_SOAK_DURATION_MS ?? 15_000);
const eventsPerSecond = Number(process.env.LOGGERJS_SOAK_EVENTS_PER_SECOND ?? 2_000);
const payloadSize = Number(process.env.LOGGERJS_SOAK_PAYLOAD_SIZE ?? 64);
const maxHeapGrowthMb = Number(process.env.LOGGERJS_SOAK_MAX_HEAP_GROWTH_MB ?? 64);
const maxLateHeapGrowthMb = Number(process.env.LOGGERJS_SOAK_MAX_LATE_HEAP_GROWTH_MB ?? 32);
const closeBudgetMs = Number(process.env.LOGGERJS_SOAK_CLOSE_BUDGET_MS ?? 30_000);
const keepFiles = process.env.LOGGERJS_SOAK_KEEP_FILES === "1";

for (const [name, value] of Object.entries({
  durationMs,
  eventsPerSecond,
  payloadSize,
  maxHeapGrowthMb,
  maxLateHeapGrowthMb,
  closeBudgetMs,
})) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number.`);
}

const { createLogger, getLoggerMetaStats, resetLoggerMetaStats } =
  await import("../packages/core/dist/index.js");
const { fileTransport, nodeHttpTransport, rotatingFileTransport } =
  await import("../packages/node/dist/index.js");

const bytesPerMb = 1024 * 1024;
const formatMb = (bytes) => `${(bytes / bytesPerMb).toFixed(1)}MB`;
const forceGc = () => {
  if (typeof globalThis.gc !== "function") return;
  for (let index = 0; index < 3; index += 1) globalThis.gc();
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The collector runs in its own process so its bookkeeping does not show up
// in this process's heap measurements.
const collectorSource = `
const { createServer } = require("node:http");
let seed = 1;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const acked = new Set();
let duplicates = 0;
let requests = 0;
const faults = { ok: 0, "server-error": 0, reset: 0, hang: 0 };
const hung = new Set();
const server = createServer((request, response) => {
  if (request.url === "/stats") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ acked: [...acked], duplicates, requests, faults }));
    return;
  }
  requests += 1;
  const roll = random();
  const fault = roll < 0.85 ? "ok" : roll < 0.95 ? "server-error" : roll < 0.98 ? "reset" : "hang";
  faults[fault] += 1;
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    if (fault === "hang") {
      hung.add(response);
      return;
    }
    if (fault === "reset") return request.socket.destroy();
    if (fault === "server-error") return response.writeHead(503).end();
    for (const event of JSON.parse(Buffer.concat(chunks).toString("utf8"))) {
      const seq = event.data.seq;
      if (acked.has(seq)) duplicates += 1;
      acked.add(seq);
    }
    response.writeHead(204).end();
  });
});
server.listen(0, "127.0.0.1", () => process.send({ port: server.address().port }));
process.on("message", (message) => {
  if (message === "stop") process.exit(0);
});
`;

const dir = mkdtempSync(join(tmpdir(), "loggerjs-soak-transports-"));
const collector = fork("-e", [collectorSource], { execArgv: [], stdio: "inherit" });
const collectorPort = await new Promise((resolve, reject) => {
  collector.once("message", (message) => resolve(message.port));
  collector.once("error", reject);
});
const collectorUrl = `http://127.0.0.1:${collectorPort}`;

const filePath = join(dir, "app.log");
const rotatingPath = join(dir, "rotating", "app.log");
const httpDropped = new Set();
let internalErrors = 0;

resetLoggerMetaStats();
const logger = createLogger({
  category: ["soak", "transports"],
  transports: [
    fileTransport({ path: filePath }),
    rotatingFileTransport({ path: rotatingPath, mkdir: true, maxBytes: 256 * 1024, maxFiles: 4 }),
    nodeHttpTransport({
      url: `${collectorUrl}/logs`,
      maxBatchSize: 200,
      flushIntervalMs: 50,
      maxQueueSize: 20_000,
      maxRetries: 3,
      retryBaseDelayMs: 20,
      retryMaxDelayMs: 500,
      circuitBreakerFailureThreshold: 20,
      circuitBreakerResetMs: 200,
      timeoutMs: 500,
      onDrop: (event) => httpDropped.add(event.data.seq),
    }),
  ],
  onInternalError: () => {
    internalErrors += 1;
  },
});

const payload = "p".repeat(payloadSize);
let emitted = 0;
forceGc();
const startHeap = process.memoryUsage().heapUsed;
const startRss = process.memoryUsage().rss;
let quarterHeap;
let peakHeap = startHeap;
const memoryTimer = setInterval(() => {
  peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
}, 500);

const startedAt = performance.now();
const tickMs = 50;
const perTick = Math.max(1, Math.round((eventsPerSecond * tickMs) / 1000));
while (performance.now() - startedAt < durationMs) {
  for (let index = 0; index < perTick; index += 1) {
    logger.info("soak event", { seq: emitted, payload });
    emitted += 1;
  }
  if (quarterHeap === undefined && performance.now() - startedAt >= durationMs / 4) {
    forceGc();
    quarterHeap = process.memoryUsage().heapUsed;
  }
  // oxlint-disable-next-line no-await-in-loop -- Producers write at a steady rate.
  await sleep(tickMs);
}

let closeError;
const closeStarted = performance.now();
const closed = await Promise.race([
  logger.close().then(
    () => true,
    (error) => {
      closeError = error;
      return true;
    },
  ),
  sleep(closeBudgetMs).then(() => false),
]);
const closeMs = performance.now() - closeStarted;
clearInterval(memoryTimer);
forceGc();
const endHeap = process.memoryUsage().heapUsed;
const endRss = process.memoryUsage().rss;

const stats = await (await fetch(`${collectorUrl}/stats`)).json();
collector.send("stop");

const failures = [];
if (!closed) failures.push(`logger.close() did not settle within ${closeBudgetMs}ms`);

// fileTransport: exactly one complete line per event, in order. Long runs
// write hundreds of megabytes, so stream the file instead of reading it whole.
let fileLineCount = 0;
let fileOrderFailure;
for await (const line of createInterface({ input: createReadStream(filePath) })) {
  const seq = JSON.parse(line).data.seq;
  if (fileOrderFailure === undefined && seq !== fileLineCount) {
    fileOrderFailure = `file log line ${fileLineCount} holds seq ${seq}`;
  }
  fileLineCount += 1;
}
if (fileOrderFailure) failures.push(fileOrderFailure);
if (fileLineCount !== emitted) {
  failures.push(`file log has ${fileLineCount} lines for ${emitted} events`);
}
const fileSize = statSync(filePath).size;
if (fileSize > 0) {
  const lastByte = Buffer.alloc(1);
  const fd = openSync(filePath, "r");
  readSync(fd, lastByte, 0, 1, fileSize - 1);
  closeSync(fd);
  if (lastByte[0] !== 0x0a) failures.push("file log does not end at a record boundary");
}

// rotatingFileTransport keeps only maxFiles archives, so check that the
// retained files are complete, contiguous, and end with the last event.
const rotatingDir = join(dir, "rotating");
const rotatingFiles = readdirSync(rotatingDir)
  .map((name) => join(rotatingDir, name))
  .filter((path) => statSync(path).isFile())
  .toSorted((a, b) => {
    const index = (path) => (path === rotatingPath ? 0 : Number(path.split(".").pop()));
    return index(b) - index(a);
  });
const rotatingSeqs = [];
for (const path of rotatingFiles) {
  const lines = readFileSync(path, "utf8").split("\n");
  if (lines.pop() !== "") failures.push(`${path} does not end at a record boundary`);
  for (const line of lines) rotatingSeqs.push(JSON.parse(line).data.seq);
}
if (rotatingSeqs.at(-1) !== emitted - 1) {
  failures.push(`rotating log ends at seq ${rotatingSeqs.at(-1)}, expected ${emitted - 1}`);
}
if (rotatingSeqs.some((seq, index) => index > 0 && seq !== rotatingSeqs[index - 1] + 1)) {
  failures.push("rotating log has a gap or reordering inside the retained files");
}

// nodeHttpTransport: every event acknowledged or reported through onDrop.
const acked = new Set(stats.acked);
const unaccounted = [];
for (let seq = 0; seq < emitted; seq += 1) {
  if (!acked.has(seq) && !httpDropped.has(seq)) unaccounted.push(seq);
}
if (unaccounted.length > 0) {
  failures.push(
    `${unaccounted.length} HTTP events were neither acknowledged nor dropped (first: ${unaccounted.slice(0, 5).join(", ")})`,
  );
}

const heapGrowth = endHeap - startHeap;
if (heapGrowth > maxHeapGrowthMb * bytesPerMb) {
  failures.push(`heap grew ${formatMb(heapGrowth)} (limit ${maxHeapGrowthMb}MB)`);
}
// Growth after the first quarter is the leak signal: warm-up is over by then.
const lateHeapGrowth = endHeap - (quarterHeap ?? startHeap);
if (lateHeapGrowth > maxLateHeapGrowthMb * bytesPerMb) {
  failures.push(
    `heap grew ${formatMb(lateHeapGrowth)} after the first quarter (limit ${maxLateHeapGrowthMb}MB)`,
  );
}

const summary = {
  emitted,
  durationMs: Math.round(performance.now() - startedAt),
  closeMs: Math.round(closeMs),
  closeError: closeError?.message,
  http: {
    requests: stats.requests,
    faults: stats.faults,
    acked: acked.size,
    duplicates: stats.duplicates,
    dropped: httpDropped.size,
  },
  rotatingFiles: rotatingFiles.length,
  heap: {
    start: formatMb(startHeap),
    quarter: formatMb(quarterHeap ?? startHeap),
    end: formatMb(endHeap),
    peak: formatMb(peakHeap),
  },
  rss: { start: formatMb(startRss), end: formatMb(endRss) },
  internalErrors,
  counters: getLoggerMetaStats(),
  gc: typeof globalThis.gc === "function" ? "available" : "unavailable",
};

if (!keepFiles && existsSync(dir)) rmSync(dir, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(JSON.stringify(summary, null, 2));
  console.error("Transport soak failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Transport soak passed: ${JSON.stringify(summary)}`);
