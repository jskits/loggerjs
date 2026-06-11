import { existsSync } from "node:fs";
import { Console } from "node:console";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { Writable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  configureSync as configureLogTapeSync,
  getJsonLinesFormatter as getLogTapeJsonLinesFormatter,
  getLogger as getLogTapeLogger,
  resetSync as resetLogTapeSync,
} from "@logtape/logtape";
import pino from "pino";
import winston from "winston";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const iterations = Number.parseInt(process.env.BENCH_ITERATIONS ?? "100000", 10);
// JIT warmup needs to be a meaningful share of the measured run; 10k was not
// enough for the competitor loggers and skewed cross-scenario comparisons.
const warmupIterations = Math.min(50_000, Math.max(1_000, Math.floor(iterations / 4)));

function distUrl(relativePath) {
  const path = join(repoRoot, relativePath);
  if (!existsSync(path)) throw new Error(`Missing ${relativePath}. Run pnpm build first.`);
  return pathToFileURL(path).href;
}

const core = await import(distUrl("packages/core/dist/index.js"));
const codecs = await import(distUrl("packages/codecs/dist/index.js"));

const sampleEvent = {
  id: "bench-1",
  time: 1_700_000_000_000,
  seq: 1,
  level: 30,
  levelName: "info",
  logger: "bench.node",
  message: "order created",
  type: "order.created",
  tags: { service: "checkout", env: "bench" },
  data: { orderId: "ord_123", amount: 42.5, currency: "USD" },
  context: { requestId: "req_123", tenantId: "tenant_1" },
};
const sampleBatch = Array.from({ length: 16 }, (_, index) => ({
  ...sampleEvent,
  id: `bench-${index}`,
  seq: index,
}));
const sampleRecordBatch = Array.from({ length: 16 }, (_, index) =>
  core.createRecord({
    time: 1_700_000_000_000,
    level: 30,
    category: ["bench", "node"],
    type: "order.created",
    tags: { service: "checkout", env: "bench" },
    msg: "order created",
    props: { orderId: "ord_123", amount: 42.5, currency: "USD" },
    ctx: { requestId: "req_123", tenantId: "tenant_1" },
    seq: index,
  }),
);

let blackhole = 0;

function consume(value) {
  if (typeof value === "string") blackhole ^= value.length;
  else if (value instanceof Uint8Array) blackhole ^= value.byteLength;
  else if (value && typeof value === "object") blackhole ^= Object.keys(value).length;
}

const blackholeStream = new Writable({
  write(chunk, _encoding, callback) {
    consume(chunk);
    callback();
  },
});

function measure(name, fn, count = iterations) {
  for (let index = 0; index < warmupIterations; index++) consume(fn(index));
  const start = performance.now();
  for (let index = 0; index < count; index++) consume(fn(index));
  const elapsedMs = performance.now() - start;
  return {
    name,
    iterations: count,
    elapsedMs,
    opsPerSecond: count / (elapsedMs / 1_000),
    nsPerOp: (elapsedMs * 1_000_000) / count,
  };
}

async function main() {
  const noopTransport = { name: "noop", log() {} };
  const noopWriteTransport = { name: "noop-write", write() {} };
  const disabledLogger = core.createLogger({ level: "info", transports: [noopTransport] });
  const noTransportLogger = core.createLogger({ level: "debug", transports: [] });
  const noopTransportLogger = core.createLogger({ level: "debug", transports: [noopTransport] });
  const recordPathLogger = core.createLogger({
    level: "debug",
    transports: [noopWriteTransport],
  });
  const batchTransport = core.batchTransport(
    {
      name: "batch-inner",
      logBatch(events) {
        blackhole ^= events.length;
      },
    },
    { maxRecords: 1024, maxWaitMs: 60_000 },
  );
  const batchLogger = core.createLogger({ level: "debug", transports: [batchTransport] });

  const originalConsole = {
    debug: console.debug,
    error: console.error,
    info: console.info,
    log: console.log,
    warn: console.warn,
  };
  for (const method of Object.keys(originalConsole)) {
    console[method] = (...args) => {
      blackhole ^= args.length;
    };
  }
  const consoleLogger = core.createLogger({
    level: "debug",
    transports: [core.consoleTransport({ pretty: false, codec: core.jsonCodec() })],
  });

  const jsonCodec = core.jsonCodec();
  const safeJsonCodec = core.safeJsonCodec();
  const fastEventJsonCodec = codecs.fastEventJsonCodec();
  const msgpackrCodec = codecs.msgpackrCodec();

  const encodedJson = jsonCodec.encode(sampleBatch);
  const encodedSafeJson = safeJsonCodec.encode(sampleBatch);
  const encodedFastJson = fastEventJsonCodec.encode(sampleBatch);
  const encodedMsgpack = msgpackrCodec.encode(sampleBatch);

  // Full-path NDJSON comparison: each logger serializes one structured info
  // log per call and hands the line to a discarding sink, so the numbers
  // compare pipeline plus serialization without I/O noise.
  const ndjsonCodec = core.ndjsonCodec();
  const loggerjsNdjsonLogger = core.createLogger({
    level: "debug",
    transports: [
      {
        name: "ndjson-sink",
        log(event) {
          consume(ndjsonCodec.encode(event));
        },
      },
    ],
  });
  // Carry the same base fields as the pino logger below so all full-path
  // scenarios serialize equivalent information.
  const benchTags = { service: "checkout", env: "bench" };
  const loggerjsRecordNdjsonLogger = core.createLogger({
    level: "debug",
    tags: benchTags,
    transports: [
      {
        name: "record-ndjson-sink",
        write(record) {
          consume(fastEventJsonCodec.encode(record));
        },
      },
    ],
  });
  const leanFastEventJsonCodec = codecs.fastEventJsonCodec({
    includeId: false,
    includeSeq: false,
    includeLevelName: false,
  });
  const loggerjsLeanRecordLogger = core.createLogger({
    level: "debug",
    tags: benchTags,
    transports: [
      {
        name: "lean-record-sink",
        write(record) {
          consume(leanFastEventJsonCodec.encode(record));
        },
      },
    ],
  });
  const loggerjsFastEventLogger = core.createLogger({
    level: "debug",
    tags: benchTags,
    transports: [
      {
        name: "fast-event-sink",
        log(event) {
          consume(fastEventJsonCodec.encode(event));
        },
      },
    ],
  });
  const pinoLogger = pino(
    { level: "debug", base: { service: "checkout", env: "bench" } },
    {
      write(line) {
        consume(line);
      },
    },
  );
  const pinoDisabledLogger = pino({ level: "info" }, { write() {} });
  resetLogTapeSync();
  const logTapeJsonLines = getLogTapeJsonLinesFormatter({
    categorySeparator: ".",
    message: "rendered",
    properties: "flatten",
  });
  configureLogTapeSync({
    sinks: {
      blackhole(record) {
        consume(logTapeJsonLines(record));
      },
    },
    loggers: [
      {
        category: ["bench", "node"],
        lowestLevel: "debug",
        parentSinks: "override",
        sinks: ["blackhole"],
      },
    ],
    reset: true,
  });
  const logTapeLogger = getLogTapeLogger(["bench", "node"]).with({
    service: "checkout",
    env: "bench",
  });
  const nativeConsole = new Console({
    colorMode: false,
    stderr: blackholeStream,
    stdout: blackholeStream,
  });
  const winstonLogger = winston.createLogger({
    level: "debug",
    format: winston.format.json(),
    defaultMeta: { service: "checkout", env: "bench" },
    transports: [
      new winston.transports.Stream({
        stream: new Writable({
          write(chunk, _encoding, callback) {
            consume(chunk);
            callback();
          },
        }),
      }),
    ],
  });

  const rows = [
    measure("disabled debug lazy log", (index) => disabledLogger.debug(() => `skip ${index}`)),
    measure("enabled logger no transports", (index) =>
      noTransportLogger.info("order created", { index }),
    ),
    measure("enabled logger noop transport", (index) =>
      noopTransportLogger.info("order created", { index }),
    ),
    measure("enabled logger record write transport", (index) =>
      recordPathLogger.info("order created", { index }),
    ),
    measure("console transport noop writer", (index) =>
      consoleLogger.info("order created", { index }),
    ),
    measure("batch transport enqueue", (index) => batchLogger.info("order created", { index })),
    measure("loggerjs ndjson event sink", (index) =>
      loggerjsNdjsonLogger.info("order created", { index }),
    ),
    measure("loggerjs fast-event-json record sink", (index) =>
      loggerjsRecordNdjsonLogger.info("order created", { index }),
    ),
    measure("loggerjs lean record sink", (index) =>
      loggerjsLeanRecordLogger.info("order created", { index }),
    ),
    measure("loggerjs fast-event-json event sink", (index) =>
      loggerjsFastEventLogger.info("order created", { index }),
    ),
    measure("pino ndjson noop sink", (index) => pinoLogger.info({ index }, "order created")),
    measure("pino disabled debug", (index) => pinoDisabledLogger.debug({ index }, "skip")),
    measure("logtape json lines noop sink", (index) =>
      logTapeLogger.info("order created", { index }),
    ),
    measure("winston json noop sink", (index) => winstonLogger.info("order created", { index })),
    measure("node console info noop stream", (index) =>
      nativeConsole.info("order created", { index }),
    ),
    measure(
      "json encode batch",
      () => jsonCodec.encode(sampleBatch),
      Math.max(10_000, Math.floor(iterations / 5)),
    ),
    measure(
      "safe-json encode batch",
      () => safeJsonCodec.encode(sampleBatch),
      Math.max(10_000, Math.floor(iterations / 5)),
    ),
    measure(
      "fast-event-json encode batch",
      () => fastEventJsonCodec.encode(sampleBatch),
      Math.max(10_000, Math.floor(iterations / 5)),
    ),
    measure(
      "fast-event-json encode record batch",
      () => fastEventJsonCodec.encode(sampleRecordBatch),
      Math.max(10_000, Math.floor(iterations / 5)),
    ),
    measure(
      "msgpackr encode batch",
      () => msgpackrCodec.encode(sampleBatch),
      Math.max(10_000, Math.floor(iterations / 5)),
    ),
    measure(
      "json decode batch",
      () => jsonCodec.decode(encodedJson),
      Math.max(10_000, Math.floor(iterations / 5)),
    ),
    measure(
      "safe-json decode batch",
      () => safeJsonCodec.decode(encodedSafeJson),
      Math.max(10_000, Math.floor(iterations / 5)),
    ),
    measure(
      "fast-event-json decode batch",
      () => fastEventJsonCodec.decode(encodedFastJson),
      Math.max(10_000, Math.floor(iterations / 5)),
    ),
    measure(
      "msgpackr decode batch",
      () => msgpackrCodec.decode(encodedMsgpack),
      Math.max(10_000, Math.floor(iterations / 5)),
    ),
  ];

  await batchLogger.flush();
  Object.assign(console, originalConsole);

  if (process.env.BENCH_JSON) {
    console.log(JSON.stringify({ iterations, rows }));
    if (blackhole === 42) console.error("blackhole", blackhole);
    return;
  }

  console.log(`Node benchmark iterations: ${iterations}`);
  console.log("| Scenario | ops/sec | ns/op | iterations |");
  console.log("| --- | ---: | ---: | ---: |");
  for (const row of rows) {
    console.log(
      `| ${row.name} | ${Math.round(row.opsPerSecond).toLocaleString("en-US")} | ${Math.round(row.nsPerOp).toLocaleString("en-US")} | ${row.iterations.toLocaleString("en-US")} |`,
    );
  }
  if (blackhole === 42) console.log("blackhole", blackhole);
}

await main();
