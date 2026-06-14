import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tempRoot = join(repoRoot, ".tmp", "package-smoke");
const tarballRoot = join(tempRoot, "tarballs");
const consumerRoot = join(tempRoot, "consumer");
const args = new Set(process.argv.slice(2));
const packOnly = args.has("--pack-only");
const smokeOnly = args.has("--smoke-only");

if (packOnly && smokeOnly) {
  throw new Error("Use either --pack-only or --smoke-only, not both.");
}

function readPackageNames() {
  return readdirSync(join(repoRoot, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(repoRoot, "packages", entry.name, "package.json"))
    .filter((path) => existsSync(path))
    .map((path) => JSON.parse(readFileSync(path, "utf8")))
    .filter((manifest) => !manifest.private)
    .map((manifest) => manifest.name)
    .toSorted();
}

function run(command, commandArgs, cwd) {
  const result = spawnSync(command, commandArgs, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(" ")} failed\n${result.stdout}${result.stderr}`);
  }
  return result.stdout;
}

function packPackages() {
  rmSync(tempRoot, { force: true, recursive: true });
  mkdirSync(tarballRoot, { recursive: true });

  const tarballs = [];
  for (const packageName of readPackageNames()) {
    const output = run(
      "pnpm",
      ["--filter", packageName, "pack", "--pack-destination", tarballRoot, "--json"],
      repoRoot,
    );
    const packed = JSON.parse(output);
    tarballs.push(packed.filename);
  }

  return tarballs;
}

function readExistingTarballs() {
  if (!existsSync(tarballRoot)) {
    throw new Error("No packed tarballs found. Run with --pack-only first.");
  }

  const tarballs = readdirSync(tarballRoot)
    .filter((filename) => filename.endsWith(".tgz"))
    .map((filename) => join(tarballRoot, filename))
    .toSorted();

  if (tarballs.length === 0) {
    throw new Error("No packed tarballs found. Run with --pack-only first.");
  }

  return tarballs;
}

function smokeTarballs(tarballs) {
  rmSync(consumerRoot, { force: true, recursive: true });
  mkdirSync(consumerRoot, { recursive: true });

  writeFileSync(
    join(consumerRoot, "package.json"),
    `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
  );

  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", ...tarballs], consumerRoot);

  writeFileSync(
    join(consumerRoot, "esm.mjs"),
    `
import { createLogger, defineEvent } from "@loggerjs/core";
import { browserHttpTransport } from "@loggerjs/browser/transport-http";
import { stdoutTransport } from "@loggerjs/node/transport-stdout";
import { prettyConsoleTransport, prettyStdoutTransport } from "@loggerjs/pretty";
import { fastEventJsonCodec, msgpackrCodec } from "@loggerjs/codecs";
import { redactProcessor } from "@loggerjs/processors";
import { otlpJsonCodec } from "@loggerjs/otel/codec-otlp-json";
import { sentryTransport } from "@loggerjs/sentry/transport";
import { lokiTransport } from "@loggerjs/loki/transport";
import { datadogLogsTransport } from "@loggerjs/datadog/transport";

const Event = defineEvent({ type: "smoke.event", message: "smoke" });
const logger = createLogger({
  processors: [redactProcessor()],
  transports: [{ log(event) { if (event.message !== "smoke") throw new Error("bad event"); } }],
});
logger.event(Event, {});
fastEventJsonCodec().encode([]);
if (!(msgpackrCodec().encode([]) instanceof Uint8Array)) throw new Error("bad msgpack payload");
otlpJsonCodec().encode([]);
browserHttpTransport({ url: "http://localhost/logs", fetchFn: async () => new Response(null, { status: 200 }) });
stdoutTransport();
prettyConsoleTransport({ console: { info() {} }, browserStyles: false });
prettyStdoutTransport({ stream: { write() {} }, process: { env: {} } });
sentryTransport({ sentry: {} });
lokiTransport({ url: "http://localhost/loki", fetchFn: async () => new Response(null, { status: 204 }) });
datadogLogsTransport({ apiKey: "test", fetchFn: async () => new Response(null, { status: 202 }) });
await logger.flush();
`,
  );

  writeFileSync(
    join(consumerRoot, "cjs.cjs"),
    `
const { createLogger } = require("@loggerjs/core");
const { msgpackrCodec } = require("@loggerjs/codecs");
const { stdoutTransport } = require("@loggerjs/node/transport-stdout");
const { prettyConsoleTransport, prettyStdoutTransport } = require("@loggerjs/pretty");
const { sentryTransport } = require("@loggerjs/sentry/transport");
const { lokiTransport } = require("@loggerjs/loki/transport");
const { datadogLogsTransport } = require("@loggerjs/datadog/transport");

const logger = createLogger({ transports: [{ log() {} }] });
logger.info("cjs smoke");
if (!(msgpackrCodec().encode([]) instanceof Uint8Array)) throw new Error("bad msgpack payload");
stdoutTransport();
prettyConsoleTransport({ console: { info() {} }, browserStyles: false });
prettyStdoutTransport({ stream: { write() {} }, process: { env: {} } });
sentryTransport({ sentry: {} });
lokiTransport({ url: "http://localhost/loki", fetchFn: async () => new Response(null, { status: 204 }) });
datadogLogsTransport({ apiKey: "test", fetchFn: async () => new Response(null, { status: 202 }) });
`,
  );

  run("node", ["esm.mjs"], consumerRoot);
  run("node", ["cjs.cjs"], consumerRoot);

  writeFileSync(
    join(consumerRoot, "typed-consumer.ts"),
    `
import { createLogger, defineEvent, type LogEvent, type Transport } from "@loggerjs/core";
import { createMiddleware } from "@loggerjs/core/middleware";
import { browserHttpTransport } from "@loggerjs/browser/transport-http";
import { browserCompressionPayloadTransform } from "@loggerjs/browser/payload-transforms";
import { fastEventJsonCodec, msgpackrCodec } from "@loggerjs/codecs";
import { databaseTransport } from "@loggerjs/database/transport";
import { nodeCompressionPayloadTransform } from "@loggerjs/node/payload-transforms";
import { stdoutTransport } from "@loggerjs/node/transport-stdout";
import { otlpJsonCodec } from "@loggerjs/otel/codec-otlp-json";
import { prettyConsoleTransport } from "@loggerjs/pretty/transport-console";
import { prettyStdoutTransport } from "@loggerjs/pretty/transport-stream";
import { openTelemetryTraceProcessor } from "@loggerjs/otel/trace";
import { redactProcessor, tagsProcessor } from "@loggerjs/processors";
import { sentryTransport, type SentryLike } from "@loggerjs/sentry";
import { lokiTransport } from "@loggerjs/loki";
import { datadogLogsTransport } from "@loggerjs/datadog";
import { elasticTransport } from "@loggerjs/elastic";
import { cloudWatchLogsTransport } from "@loggerjs/cloudwatch";

const OrderEvent = defineEvent<{ orderId: string }>({
  type: "order.created",
  message: (payload) => payload.orderId,
});

const transport: Transport = {
  log(event: LogEvent) {
    if (event.message.length === 0) throw new Error("expected message");
  },
};

const logger = createLogger({
  processors: [redactProcessor(), tagsProcessor({ runtime: "packed-consumer" })],
  transports: [
    transport,
    stdoutTransport(),
    prettyConsoleTransport({ console: { info() {} }, browserStyles: false }),
    prettyStdoutTransport({ stream: { write() {} }, process: { env: {} } }),
  ],
});

logger.event(OrderEvent, { orderId: "ord_123" });
createMiddleware("typed", (record) => record);
fastEventJsonCodec().encode([]);
msgpackrCodec().encode([]);
otlpJsonCodec().encode([]);
browserCompressionPayloadTransform();
nodeCompressionPayloadTransform();
openTelemetryTraceProcessor();
browserHttpTransport({ url: "/logs", fetchFn: async () => new Response(null, { status: 204 }) });
databaseTransport({ adapter: { insert: async () => undefined } });
sentryTransport({ sentry: {} satisfies SentryLike });
lokiTransport({ url: "http://localhost/loki", fetchFn: async () => new Response(null, { status: 204 }) });
datadogLogsTransport({ apiKey: "test", fetchFn: async () => new Response(null, { status: 202 }) });
elasticTransport({
  url: "http://localhost:9200",
  fetchFn: async () => new Response(JSON.stringify({ errors: false }), { status: 200 }),
});
cloudWatchLogsTransport({
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
  logGroupName: "group",
  logStreamName: "stream",
  region: "us-east-1",
  signer: async (request) => request.headers,
  fetchFn: async () => new Response("{}", { status: 200 }),
});
`,
  );

  writeFileSync(
    join(consumerRoot, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          exactOptionalPropertyTypes: false,
          lib: ["ES2022", "DOM"],
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          skipLibCheck: true,
          strict: true,
          target: "ES2022",
          types: ["node"],
        },
        include: ["typed-consumer.ts"],
      },
      null,
      2,
    )}\n`,
  );

  run(
    process.execPath,
    [require.resolve("typescript/bin/tsc"), "-p", "tsconfig.json"],
    consumerRoot,
  );

  console.log(
    `Smoke tested ${tarballs.length} packed packages in a temporary runtime and typed consumer.`,
  );
}

try {
  const tarballs = smokeOnly ? readExistingTarballs() : packPackages();

  if (packOnly) {
    console.log(`Packed ${tarballs.length} packages for later smoke testing.`);
  } else {
    smokeTarballs(tarballs);
  }
} finally {
  if (!packOnly) {
    rmSync(tempRoot, { force: true, recursive: true });
  }
}
