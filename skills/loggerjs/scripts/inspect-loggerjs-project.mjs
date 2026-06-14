#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const targetDir = resolve(process.argv[2] ?? process.cwd());
const packagePath = join(targetDir, "package.json");

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function dependencyMap(pkg) {
  return {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.peerDependencies,
    ...pkg.optionalDependencies,
  };
}

function detectPackageManager(pkg) {
  if (typeof pkg.packageManager === "string") {
    return pkg.packageManager.split("@")[0];
  }
  if (existsSync(join(targetDir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(targetDir, "yarn.lock"))) return "yarn";
  if (existsSync(join(targetDir, "bun.lock")) || existsSync(join(targetDir, "bun.lockb"))) {
    return "bun";
  }
  if (existsSync(join(targetDir, "package-lock.json"))) return "npm";
  return "npm";
}

function namesMatching(deps, candidates) {
  return candidates.filter((name) => deps[name] !== undefined);
}

function detectFrameworks(deps) {
  const checks = {
    react: ["react"],
    next: ["next"],
    vue: ["vue"],
    nuxt: ["nuxt"],
    svelte: ["svelte", "@sveltejs/kit"],
    angular: ["@angular/core"],
    astro: ["astro"],
    vite: ["vite"],
    express: ["express"],
    fastify: ["fastify"],
    koa: ["koa"],
    hapi: ["@hapi/hapi"],
    nest: ["@nestjs/core"],
    prisma: ["prisma", "@prisma/client"],
    bullmq: ["bullmq"],
    cloudflareWorkers: ["wrangler", "@cloudflare/workers-types"],
  };

  return Object.entries(checks)
    .filter(([, names]) => names.some((name) => deps[name] !== undefined))
    .map(([name]) => name);
}

function sourceFiles(root) {
  const startDirs = ["src", "app", "pages", "routes", "server", "client", "lib"];
  const extensions = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);
  const files = [];

  function visit(dir) {
    if (files.length >= 250 || !existsSync(dir)) return;

    for (const entry of readdirSync(dir)) {
      if (files.length >= 250) return;
      if (
        entry === "node_modules" ||
        entry === "dist" ||
        entry === "build" ||
        entry.startsWith(".")
      ) {
        continue;
      }

      const path = join(dir, entry);
      let stats;
      try {
        stats = statSync(path);
      } catch {
        continue;
      }

      if (stats.isDirectory()) {
        visit(path);
      } else if (extensions.has(entry.slice(entry.lastIndexOf(".")))) {
        files.push(path);
      }
    }
  }

  for (const dir of startDirs) visit(join(root, dir));
  return files;
}

function scanSources(files) {
  const signals = {
    consoleCalls: 0,
    importsLoggerjs: false,
    referencesWindow: false,
    referencesProcess: false,
  };

  for (const file of files) {
    let contents = "";
    try {
      contents = readFileSync(file, "utf8");
    } catch {
      continue;
    }

    signals.consoleCalls +=
      contents.match(/\bconsole\.(debug|log|info|warn|error|trace)\b/g)?.length ?? 0;
    signals.importsLoggerjs ||= /from\s+["']@loggerjs\//.test(contents);
    signals.referencesWindow ||= /\b(window|document|navigator)\b/.test(contents);
    signals.referencesProcess ||= /\bprocess\.(env|on|once|exit|stdout|stderr)\b/.test(contents);
  }

  return signals;
}

function detectRuntimes(pkg, deps, frameworks, sourceSignals) {
  const runtimes = new Set();
  const scripts = Object.values(pkg.scripts ?? {}).join(" ");

  if (
    frameworks.some((name) =>
      ["express", "fastify", "koa", "hapi", "nest", "prisma", "bullmq"].includes(name),
    ) ||
    /\b(node|tsx|ts-node|nodemon)\b/.test(scripts) ||
    sourceSignals.referencesProcess
  ) {
    runtimes.add("node");
  }

  if (
    frameworks.some((name) =>
      ["react", "next", "vue", "nuxt", "svelte", "angular", "astro", "vite"].includes(name),
    ) ||
    sourceSignals.referencesWindow
  ) {
    runtimes.add("browser");
  }

  if (frameworks.includes("cloudflareWorkers") || /\b(worker|workerd|wrangler)\b/.test(scripts)) {
    runtimes.add("edge-worker");
  }

  if (pkg.bin !== undefined) runtimes.add("cli");

  if (
    pkg.private !== true &&
    (pkg.exports !== undefined || pkg.main !== undefined || pkg.module !== undefined)
  ) {
    runtimes.add("library");
  }

  if (runtimes.size === 0 && Object.keys(deps).length === 0) {
    runtimes.add("unknown");
  }

  return [...runtimes];
}

function recommendPackages(deps, runtimes) {
  const recommended = new Set();

  if (runtimes.includes("node") || runtimes.includes("cli")) {
    recommended.add("@loggerjs/node");
    recommended.add("@loggerjs/processors");
  }
  if (runtimes.includes("browser")) {
    recommended.add("@loggerjs/browser");
    recommended.add("@loggerjs/processors");
  }
  if (runtimes.includes("edge-worker") && !runtimes.includes("browser")) {
    recommended.add("@loggerjs/core");
    recommended.add("@loggerjs/processors");
  }
  if (runtimes.includes("library") && recommended.size === 0) {
    recommended.add("@loggerjs/core");
  }

  if (deps["@opentelemetry/api"] || deps["@opentelemetry/sdk-node"])
    recommended.add("@loggerjs/otel");
  if (Object.keys(deps).some((name) => name.startsWith("@sentry/")))
    recommended.add("@loggerjs/sentry");
  if (deps["@datadog/browser-logs"] || deps["@datadog/datadog-api-client"])
    recommended.add("@loggerjs/datadog");
  if (deps["@elastic/elasticsearch"]) recommended.add("@loggerjs/elastic");
  if (deps["@aws-sdk/client-cloudwatch-logs"] || deps["aws-sdk"])
    recommended.add("@loggerjs/cloudwatch");
  if (deps.pg || deps.postgres || deps.better_sqlite3 || deps.sqlite3)
    recommended.add("@loggerjs/database");

  return [...recommended].filter((name) => deps[name] === undefined);
}

function installCommand(packageManager, packages) {
  if (packages.length === 0) return undefined;
  const verb =
    packageManager === "yarn" || packageManager === "pnpm" || packageManager === "bun"
      ? "add"
      : "install";
  return `${packageManager} ${verb} ${packages.join(" ")}`;
}

const pkg = readJson(packagePath);

if (!pkg) {
  console.error(`Could not read package.json at ${packagePath}`);
  process.exitCode = 1;
} else {
  const deps = dependencyMap(pkg);
  const files = sourceFiles(targetDir);
  const sourceSignals = scanSources(files);
  const frameworks = detectFrameworks(deps);
  const runtimes = detectRuntimes(pkg, deps, frameworks, sourceSignals);
  const loggerDeps = namesMatching(deps, [
    "pino",
    "winston",
    "bunyan",
    "loglevel",
    "debug",
    "consola",
    "tslog",
    "signale",
    "@logtape/logtape",
  ]);
  const packageManager = detectPackageManager(pkg);
  const recommendedPackages = recommendPackages(deps, runtimes);

  console.log(
    JSON.stringify(
      {
        cwd: targetDir,
        packageManager,
        moduleType: pkg.type ?? "commonjs",
        private: pkg.private === true,
        frameworks,
        runtimes,
        existingLoggerDependencies: loggerDeps,
        loggerjsPackages: Object.keys(deps).filter((name) => name.startsWith("@loggerjs/")),
        sourceSignals,
        recommendedPackages,
        installCommand: installCommand(packageManager, recommendedPackages),
      },
      null,
      2,
    ),
  );
}
