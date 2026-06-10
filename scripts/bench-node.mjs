import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const iterations = Number.parseInt(process.env.BENCH_ITERATIONS ?? "100000", 10);
const warmupIterations = Math.min(10_000, Math.max(1_000, Math.floor(iterations / 10)));

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

let blackhole = 0;

function consume(value) {
  if (typeof value === "string") blackhole ^= value.length;
  else if (value instanceof Uint8Array) blackhole ^= value.byteLength;
  else if (value && typeof value === "object") blackhole ^= Object.keys(value).length;
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
    opsPerSecond: count / (elapsedMs / 1_000),
    nsPerOp: (elapsedMs * 1_000_000) / count,
  };
}

async function main() {
  const noopTransport = { name: "noop", log() {} };
  const disabledLogger = core.createLogger({ level: "info", transports: [noopTransport] });
  const noTransportLogger = core.createLogger({ level: "debug", transports: [] });
  const noopTransportLogger = core.createLogger({ level: "debug", transports: [noopTransport] });
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
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();
  const msgpackAdapter = codecs.msgpackrCodec({
    pack(value) {
      return textEncoder.encode(JSON.stringify(value));
    },
    unpack(payload) {
      return JSON.parse(textDecoder.decode(payload));
    },
  });

  const encodedJson = jsonCodec.encode(sampleBatch);
  const encodedSafeJson = safeJsonCodec.encode(sampleBatch);
  const encodedFastJson = fastEventJsonCodec.encode(sampleBatch);
  const encodedMsgpack = msgpackAdapter.encode(sampleBatch);

  const rows = [
    measure("disabled debug lazy log", (index) => disabledLogger.debug(() => `skip ${index}`)),
    measure("enabled logger no transports", (index) =>
      noTransportLogger.info("order created", { index }),
    ),
    measure("enabled logger noop transport", (index) =>
      noopTransportLogger.info("order created", { index }),
    ),
    measure("console transport noop writer", (index) =>
      consoleLogger.info("order created", { index }),
    ),
    measure("batch transport enqueue", (index) => batchLogger.info("order created", { index })),
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
      "msgpack adapter encode batch",
      () => msgpackAdapter.encode(sampleBatch),
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
      "msgpack adapter decode batch",
      () => msgpackAdapter.decode(encodedMsgpack),
      Math.max(10_000, Math.floor(iterations / 5)),
    ),
  ];

  await batchLogger.flush();
  Object.assign(console, originalConsole);

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
