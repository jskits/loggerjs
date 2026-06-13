import { performance } from "node:perf_hooks";

const durationMs = Number(process.env.LOGGERJS_SOAK_DURATION_MS ?? 15_000);
const concurrency = Number(process.env.LOGGERJS_SOAK_CONCURRENCY ?? 32);
const minEvents = Number(process.env.LOGGERJS_SOAK_MIN_EVENTS ?? 20_000);
const payloadSize = Number(process.env.LOGGERJS_SOAK_PAYLOAD_SIZE ?? 256);

if (!Number.isFinite(durationMs) || durationMs <= 0) {
  throw new Error("LOGGERJS_SOAK_DURATION_MS must be a positive number.");
}
if (!Number.isInteger(concurrency) || concurrency <= 0) {
  throw new Error("LOGGERJS_SOAK_CONCURRENCY must be a positive integer.");
}
if (!Number.isInteger(minEvents) || minEvents <= 0) {
  throw new Error("LOGGERJS_SOAK_MIN_EVENTS must be a positive integer.");
}

const { batchTransport, createLogger, getLoggerMetaStats, resetLoggerMetaStats } =
  await import("../packages/core/dist/index.js");

resetLoggerMetaStats();

let stored = 0;
const sink = {
  name: "soak-counting-sink",
  log() {
    stored += 1;
  },
  logBatch(events) {
    stored += events.length;
  },
};
const batch = batchTransport(sink, {
  concurrency: Math.min(8, concurrency),
  dropPolicy: "throw",
  flushIntervalMs: 10,
  maxBatchSize: 128,
  maxQueueSize: minEvents + concurrency * 512,
});
const logger = createLogger({
  category: ["soak", "concurrency"],
  transports: [batch],
});

const payload = "x".repeat(payloadSize);
const deadline = performance.now() + durationMs;
let emitted = 0;
let nextSeq = 0;

async function worker(workerId) {
  let localCount = 0;
  while (performance.now() < deadline || emitted < minEvents) {
    const seq = nextSeq;
    nextSeq += 1;
    logger.info("soak event", {
      payload,
      seq,
      workerId,
      localCount,
    });
    emitted += 1;
    localCount += 1;
    if (localCount % 250 === 0) {
      // oxlint-disable-next-line no-await-in-loop -- Intentional yield keeps concurrent producers interleaved.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
}

const startedAt = performance.now();
await Promise.all(Array.from({ length: concurrency }, (_, index) => worker(index)));
await logger.flush();
await batch.close?.();
const elapsedMs = performance.now() - startedAt;

const stats = batch.stats();
const counters = getLoggerMetaStats();
if (stored !== emitted) {
  throw new Error(`Soak event count mismatch: emitted ${emitted}, stored ${stored}`);
}
if (emitted < minEvents) {
  throw new Error(`Soak emitted ${emitted} events, expected at least ${minEvents}`);
}
if (stats.queueDepth !== 0) {
  throw new Error(`Batch queue was not drained: ${stats.queueDepth}`);
}
if (stats.flushErrors !== 0 || stats.retryExhausted !== 0) {
  throw new Error(`Batch transport reported failures: ${JSON.stringify(stats)}`);
}
if (counters["transport.dropped"] || counters["internal.errors"]) {
  throw new Error(`Logger meta reported drops/internal errors: ${JSON.stringify(counters)}`);
}

console.log(
  `Soak passed: ${emitted} events, ${concurrency} workers, ${Math.round(elapsedMs)}ms, ${stats.flushes} flushes.`,
);
