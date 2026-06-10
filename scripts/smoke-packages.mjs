import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tempRoot = join(repoRoot, ".tmp", "package-smoke");
const tarballRoot = join(tempRoot, "tarballs");
const consumerRoot = join(tempRoot, "consumer");

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

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}${result.stderr}`);
  }
  return result.stdout;
}

rmSync(tempRoot, { force: true, recursive: true });
mkdirSync(tarballRoot, { recursive: true });
mkdirSync(consumerRoot, { recursive: true });

try {
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
import { fastEventJsonCodec } from "@loggerjs/codecs";
import { redactProcessor } from "@loggerjs/processors";
import { otlpJsonCodec } from "@loggerjs/otel/codec-otlp-json";
import { sentryTransport } from "@loggerjs/sentry/transport";

const Event = defineEvent({ type: "smoke.event", message: "smoke" });
const logger = createLogger({
  processors: [redactProcessor()],
  transports: [{ log(event) { if (event.message !== "smoke") throw new Error("bad event"); } }],
});
logger.event(Event, {});
fastEventJsonCodec().encode([]);
otlpJsonCodec().encode([]);
browserHttpTransport({ url: "http://localhost/logs", fetchFn: async () => new Response(null, { status: 200 }) });
stdoutTransport();
sentryTransport({ sentry: {} });
await logger.flush();
`,
  );

  writeFileSync(
    join(consumerRoot, "cjs.cjs"),
    `
const { createLogger } = require("@loggerjs/core");
const { stdoutTransport } = require("@loggerjs/node/transport-stdout");
const { sentryTransport } = require("@loggerjs/sentry/transport");

const logger = createLogger({ transports: [{ log() {} }] });
logger.info("cjs smoke");
stdoutTransport();
sentryTransport({ sentry: {} });
`,
  );

  run("node", ["esm.mjs"], consumerRoot);
  run("node", ["cjs.cjs"], consumerRoot);
  console.log(`Smoke tested ${tarballs.length} packed packages in a temporary consumer.`);
} finally {
  rmSync(tempRoot, { force: true, recursive: true });
}
