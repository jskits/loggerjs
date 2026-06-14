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

function abPercentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return Number.NaN;
  const pos = (sortedAsc.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
}

function abStats(samples) {
  const sorted = samples.toSorted((a, b) => a - b);
  return {
    median: abPercentile(sorted, 0.5),
    p25: abPercentile(sorted, 0.25),
    p75: abPercentile(sorted, 0.75),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

// Paired per-round ratio a/b: both contenders are timed back-to-back inside the
// same round, so frequency scaling, P/E-core scheduling, GC pauses, and
// background load hit them almost equally and cancel in the ratio. This is the
// only trustworthy cross-logger comparison when the machine is not perfectly
// quiet — the normal suite times each logger once, at a different moment, so a
// single sequential run's cross-logger ratio is hostage to per-moment drift.
function abRatioStats(samplesA, samplesB) {
  const ratios = samplesA.map((a, index) => a / samplesB[index]).toSorted((x, y) => x - y);
  return {
    median: abPercentile(ratios, 0.5),
    min: ratios[0],
    max: ratios[ratios.length - 1],
  };
}

// Interleaved A/B contest. Every round runs a small batch of EACH contender
// back-to-back, rotating the start position so none is always first or last,
// and repeats for many rounds. Reports per-contender ns/op plus paired
// per-round ratios, which stay valid even on a loaded or thermally drifting
// machine. Tune with BENCH_AB_ROUNDS / BENCH_AB_BATCH / BENCH_AB_WARMUP.
function runInterleavedAB(contenders, options = {}) {
  const rounds = Number.parseInt(process.env.BENCH_AB_ROUNDS ?? "60", 10);
  const batch = Number.parseInt(process.env.BENCH_AB_BATCH ?? "5000", 10);
  const warmup = Number.parseInt(process.env.BENCH_AB_WARMUP ?? "100000", 10);
  const baselineName = options.baseline ?? contenders[0].name;

  // Settle JIT and inline caches for every contender before any timing.
  for (const contender of contenders) {
    for (let index = 0; index < warmup; index++) consume(contender.run(index));
  }

  const samples = new Map(contenders.map((contender) => [contender.name, []]));
  const count = contenders.length;
  for (let round = 0; round < rounds; round++) {
    const offset = round % count;
    for (let step = 0; step < count; step++) {
      const contender = contenders[(offset + step) % count];
      const start = performance.now();
      for (let index = 0; index < batch; index++) consume(contender.run(index));
      samples.get(contender.name).push(((performance.now() - start) * 1_000_000) / batch);
    }
  }

  const summary = contenders.map((contender) => ({
    name: contender.name,
    ...abStats(samples.get(contender.name)),
  }));
  const base = summary.find((entry) => entry.name === baselineName);

  // Every non-baseline contender vs the baseline, plus consecutive non-baseline
  // pairs (e.g. prepared vs lean) — the most robust internal comparison.
  const nonBaseline = contenders.filter((contender) => contender.name !== baselineName);
  const pairs = nonBaseline.map((contender) => [contender.name, baselineName]);
  for (let index = 1; index < nonBaseline.length; index++) {
    pairs.push([nonBaseline[index].name, nonBaseline[index - 1].name]);
  }
  const ratios = pairs.map(([a, b]) => {
    const stats = abRatioStats(samples.get(a), samples.get(b));
    return { a, b, median: stats.median, min: stats.min, max: stats.max };
  });
  const spreadPct = ((base.max - base.min) / base.median) * 100;

  if (process.env.BENCH_JSON) {
    console.log(
      JSON.stringify({
        mode: "ab",
        rounds,
        batch,
        warmup,
        baseline: baselineName,
        summary,
        ratios,
        baselineSpreadPct: spreadPct,
      }),
    );
    return;
  }

  console.log(
    `Interleaved A/B — ${rounds} rounds x ${batch} ops/contender, order rotated, ${warmup} warmup/contender`,
  );
  console.log(
    "Each round times all contenders back-to-back, so drift hits them equally and cancels in the ratio.\n",
  );
  console.log("Per-contender ns/op  (median [p25..p75], min..max):");
  for (const entry of summary) {
    console.log(
      `  ${entry.name.padEnd(22)} ${entry.median.toFixed(1).padStart(7)}  [${entry.p25.toFixed(1)}..${entry.p75.toFixed(1)}]  (min ${entry.min.toFixed(1)}, max ${entry.max.toFixed(1)})`,
    );
  }
  console.log("\nPaired per-round ratios  (median [min..max]):");
  for (const ratio of ratios) {
    const pct = (1 / ratio.median) * 100;
    console.log(
      `  ${`${ratio.a} / ${ratio.b}`.padEnd(40)} ${ratio.median.toFixed(3)}x  [${ratio.min.toFixed(3)}..${ratio.max.toFixed(3)}]  => ${ratio.a} is ${pct.toFixed(1)}% of ${ratio.b}`,
    );
  }
  console.log(
    `\nBaseline "${baselineName}" stability: median ${base.median.toFixed(1)}ns, spread ${spreadPct.toFixed(0)}% (min ${base.min.toFixed(1)}, max ${base.max.toFixed(1)})`,
  );
  if (spreadPct > 25) {
    console.log(
      "  WARNING: baseline spread > 25% -> machine is drifting; the paired ratios stay fair, but the absolute per-contender ns are noisy.",
    );
  }
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
  const preparedLeanRecordEncoder = core.createPreparedRecordEncoder(leanFastEventJsonCodec);
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
  const loggerjsPreparedLeanRecordLogger = core.createLogger({
    level: "debug",
    tags: benchTags,
    transports: [
      {
        name: "prepared-lean-record-sink",
        write(record) {
          consume(preparedLeanRecordEncoder(record));
        },
      },
    ],
  });
  const preparedFastEventRecordEncoder = core.createPreparedRecordEncoder(fastEventJsonCodec);
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

  // Apples-to-apples cross-logger comparison. The normal suite times each
  // logger once at a different point in the run, so its loggerjs-vs-pino ratio
  // drifts with CPU frequency and scheduling. BENCH_AB interleaves the
  // contenders so they share identical conditions every round. Use this — not a
  // single sequential run — to settle any loggerjs-vs-pino question.
  if (process.env.BENCH_AB) {
    // The suite patches console for the console scenario; restore it so the
    // A/B report reaches stdout.
    Object.assign(console, originalConsole);
    runInterleavedAB(
      [
        { name: "pino ndjson", run: (index) => pinoLogger.info({ index }, "order created") },
        {
          name: "loggerjs lean",
          run: (index) => loggerjsLeanRecordLogger.info("order created", { index }),
        },
        {
          name: "loggerjs prepared",
          run: (index) => loggerjsPreparedLeanRecordLogger.info("order created", { index }),
        },
      ],
      { baseline: "pino ndjson" },
    );
    await batchLogger.flush();
    return;
  }

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
    measure("loggerjs prepared lean record sink", (index) =>
      loggerjsPreparedLeanRecordLogger.info("order created", { index }),
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
      "fast-event-json prepared encode record",
      () => preparedFastEventRecordEncoder(sampleRecordBatch[0]),
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
