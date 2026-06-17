import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tempRoot = join(repoRoot, ".tmp", "runtime-smoke");
const tarballRoot = join(tempRoot, "tarballs");
const consumerRoot = join(tempRoot, "consumer");
const runtimes = new Set(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith("--runtime="))
    .map((arg) => arg.slice("--runtime=".length)),
);
const selectedRuntimes = runtimes.size > 0 ? [...runtimes] : ["bun", "deno", "workers"];
const packageNames = ["@loggerjs/browser", "@loggerjs/core", "@loggerjs/processors"];
const isCi = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";

function run(command, commandArgs, cwd, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(" ")} failed\n${result.stdout}${result.stderr}`);
  }
  return result.stdout ?? "";
}

function commandExists(command) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8" });
  return result.status === 0;
}

function shouldSkipMissingCommand(runtimeName, command, installHint) {
  if (commandExists(command)) return false;

  const message = `${command} is required for ${runtimeName} runtime smoke. ${installHint}`;
  if (isCi) {
    throw new Error(message);
  }

  console.warn(`Skipping ${runtimeName} runtime smoke: ${message}`);
  return true;
}

function packRuntimePackages() {
  rmSync(tempRoot, { force: true, recursive: true });
  mkdirSync(tarballRoot, { recursive: true });

  const tarballs = [];
  for (const packageName of packageNames) {
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

function setupConsumer(tarballs) {
  mkdirSync(consumerRoot, { recursive: true });
  writeFileSync(
    join(consumerRoot, "package.json"),
    `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
  );
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", ...tarballs], consumerRoot);
}

function writeRuntimeSmokeEntry(filename, modulePrefix = "") {
  writeFileSync(
    join(consumerRoot, filename),
    `
import { createLogger, defineEvent, safeJsonCodec } from "${modulePrefix}@loggerjs/core";
import { browserHttpTransport } from "${modulePrefix}@loggerjs/browser/transport-http";
import { redactProcessor, tagsProcessor } from "${modulePrefix}@loggerjs/processors";

function toText(body) {
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  return String(body ?? "");
}

export async function runLoggerRuntimeSmoke(runtime) {
  const postedBodies = [];
  const capturedMessages = [];
  const RuntimeEvent = defineEvent({
    type: "runtime.smoke",
    message: (payload) => \`runtime-smoke-\${payload.runtime}\`,
  });

  const logger = createLogger({
    processors: [redactProcessor(), tagsProcessor({ runtime })],
    transports: [
      {
        log(event) {
          capturedMessages.push(event.message);
        },
      },
      browserHttpTransport({
        url: "https://loggerjs.invalid/runtime-smoke",
        codec: safeJsonCodec(),
        flushIntervalMs: 60_000,
        fetchFn: async (_input, init) => {
          postedBodies.push(toText(init?.body));
          return new Response(null, { status: 204 });
        },
      }),
    ],
  });

  logger.event(RuntimeEvent, { runtime, password: "runtime-secret" });
  await logger.flush();

  const posted = postedBodies.join("\\n");
  if (!capturedMessages.includes(\`runtime-smoke-\${runtime}\`)) {
    throw new Error(\`missing captured runtime smoke event for \${runtime}\`);
  }
  if (!posted.includes("runtime.smoke")) {
    throw new Error(\`missing posted runtime smoke payload for \${runtime}\`);
  }
  if (posted.includes("runtime-secret")) {
    throw new Error(\`runtime secret was not redacted for \${runtime}\`);
  }
  if (!posted.includes("[REDACTED]")) {
    throw new Error(\`missing redacted marker for \${runtime}\`);
  }
}

if (typeof globalThis.__LOGGERJS_RUNTIME_SMOKE__ === "string") {
  await runLoggerRuntimeSmoke(globalThis.__LOGGERJS_RUNTIME_SMOKE__);
}
`,
  );
}

function smokeBun() {
  if (
    shouldSkipMissingCommand("Bun", "bun", "Install Bun or run this in CI with oven-sh/setup-bun.")
  ) {
    return;
  }

  writeRuntimeSmokeEntry("bun-smoke.mjs");
  writeFileSync(
    join(consumerRoot, "bun-runner.mjs"),
    `globalThis.__LOGGERJS_RUNTIME_SMOKE__ = "bun";\nawait import("./bun-smoke.mjs");\n`,
  );
  run("bun", ["bun-runner.mjs"], consumerRoot);
  console.log("Bun runtime smoke passed.");
}

function smokeDeno() {
  if (
    shouldSkipMissingCommand(
      "Deno",
      "deno",
      "Install Deno or run this in CI with denoland/setup-deno.",
    )
  ) {
    return;
  }

  writeRuntimeSmokeEntry("deno-smoke.mjs");
  writeFileSync(
    join(consumerRoot, "deno.json"),
    `${JSON.stringify({ nodeModulesDir: "manual" }, null, 2)}\n`,
  );
  writeFileSync(
    join(consumerRoot, "deno-runner.mjs"),
    `globalThis.__LOGGERJS_RUNTIME_SMOKE__ = "deno";\nawait import("./deno-smoke.mjs");\n`,
  );
  run(
    "deno",
    ["run", "--allow-read", "--allow-env", "--node-modules-dir=manual", "deno-runner.mjs"],
    consumerRoot,
  );
  console.log("Deno runtime smoke passed.");
}

function findWorkerdBinary() {
  const workerdPackageJson = require.resolve("workerd/package.json");
  const candidate = join(dirname(workerdPackageJson), "bin", "workerd");
  if (!existsSync(candidate) || !statSync(candidate).isFile()) {
    throw new Error("workerd binary was not installed.");
  }
  return candidate;
}

async function smokeWorkers() {
  const workerdBinary = findWorkerdBinary();
  const version = run(workerdBinary, ["--version"], repoRoot).trim();
  if (!version.startsWith("workerd ")) {
    throw new Error(`Unexpected workerd version output: ${version}`);
  }

  writeRuntimeSmokeEntry("worker-entry.mjs");
  writeFileSync(
    join(consumerRoot, "worker.mjs"),
    `
import { runLoggerRuntimeSmoke } from "./worker-entry.mjs";

export default {
  async fetch() {
    await runLoggerRuntimeSmoke("workers");
    return new Response("ok", { status: 200 });
  },
};
`,
  );

  const bundlePath = join(consumerRoot, "worker.bundle.mjs");
  run(
    "pnpm",
    [
      "exec",
      "rolldown",
      join(consumerRoot, "worker.mjs"),
      "--file",
      bundlePath,
      "--format",
      "esm",
      "--platform",
      "browser",
    ],
    repoRoot,
  );

  const { Miniflare } = await import("miniflare");
  const mf = new Miniflare({
    compatibilityDate: "2026-06-13",
    modules: true,
    scriptPath: bundlePath,
  });

  try {
    const response = await mf.dispatchFetch("https://loggerjs.invalid/runtime-smoke");
    const body = await response.text();
    if (response.status !== 200 || body !== "ok") {
      throw new Error(`Unexpected workers response ${response.status}: ${body}`);
    }
  } finally {
    await mf.dispose();
  }

  console.log(`${version} runtime smoke passed through Miniflare.`);
}

const tarballs = packRuntimePackages();
setupConsumer(tarballs);

try {
  for (const runtime of selectedRuntimes) {
    if (runtime === "bun") {
      smokeBun();
    } else if (runtime === "deno") {
      smokeDeno();
    } else if (runtime === "workers" || runtime === "workerd" || runtime === "miniflare") {
      // oxlint-disable-next-line no-await-in-loop -- Runtime smokes share one temporary consumer.
      await smokeWorkers();
    } else {
      throw new Error(`Unknown runtime: ${runtime}`);
    }
  }
} finally {
  rmSync(tempRoot, { force: true, recursive: true });
}
