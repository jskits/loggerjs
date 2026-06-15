import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const args = new Map(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith("--") && arg.includes("="))
    .map((arg) => {
      const index = arg.indexOf("=");
      return [arg.slice(2, index), arg.slice(index + 1)];
    }),
);

const providerArg = args.get("provider") ?? "all";
const providers =
  providerArg === "all" ? ["elastic", "loki", "datadog", "cloudwatch"] : providerArg.split(",");
const checkConfig = args.get("check-config") === "true";
const requireReady = args.get("require-ready") === "true";

const providerConfig = {
  cloudwatch: {
    mode: "external",
    optional: ["AWS_SESSION_TOKEN", "CLOUDWATCH_ENDPOINT", "CLOUDWATCH_LOG_STREAM"],
    required: ["AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "CLOUDWATCH_LOG_GROUP"],
  },
  datadog: {
    mode: "external",
    optional: ["DATADOG_SEARCH_URL", "DATADOG_SERVICE", "DATADOG_SITE"],
    required: ["DATADOG_API_KEY", "DATADOG_APP_KEY"],
  },
  elastic: {
    mode: "docker-or-external",
    optional: ["ELASTIC_API_KEY", "ELASTIC_DOCKER_IMAGE", "ELASTIC_URL"],
    required: [],
    urlEnv: "ELASTIC_URL",
  },
  loki: {
    mode: "docker-or-external",
    optional: ["LOKI_DOCKER_IMAGE", "LOKI_TENANT_ID", "LOKI_URL"],
    required: [],
    urlEnv: "LOKI_URL",
  },
};

function optionalEnv(name) {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function envOr(name, fallback) {
  return optionalEnv(name) ?? fallback;
}

const elasticImage = envOr(
  "ELASTIC_DOCKER_IMAGE",
  "docker.elastic.co/elasticsearch/elasticsearch:8.15.3",
);
const lokiImage = envOr("LOKI_DOCKER_IMAGE", "grafana/loki:3.3.2");

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(" ")} failed\n${result.stdout}${result.stderr}`);
  }
  return result.stdout ?? "";
}

function requireEnv(name) {
  const value = optionalEnv(name);
  if (!value) throw new Error(`${name} is required for this live integration.`);
  return value;
}

function escapeActionsAnnotation(value) {
  return value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

function reportFailure(error) {
  if (process.env.GITHUB_ACTIONS !== "true") return;
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(`::error::${escapeActionsAnnotation(message)}`);
}

function formatEnvList(names) {
  return names.length === 0 ? "-" : names.join(", ");
}

function providerReadiness(provider) {
  const config = providerConfig[provider];
  if (!config) throw new Error(`Unknown provider: ${provider}`);
  const missing = config.required.filter((name) => !optionalEnv(name));
  if (missing.length > 0) {
    return { ready: false, status: `missing ${formatEnvList(missing)}` };
  }
  if (config.mode === "docker-or-external") {
    if (optionalEnv(config.urlEnv)) return { ready: true, status: `ready via ${config.urlEnv}` };
    if (dockerAvailable()) return { ready: true, status: "ready via Docker" };
    return {
      ready: false,
      status: `missing ${config.urlEnv} and Docker is unavailable`,
    };
  }
  return { ready: true, status: "ready" };
}

function reportConfig() {
  const lines = [
    "| Provider | Mode | Required env | Optional env | Status |",
    "| --- | --- | --- | --- | --- |",
  ];
  const notReady = [];
  for (const provider of providers) {
    const config = providerConfig[provider];
    if (!config) throw new Error(`Unknown provider: ${provider}`);
    const readiness = providerReadiness(provider);
    if (!readiness.ready) notReady.push(`${provider}: ${readiness.status}`);
    lines.push(
      `| ${provider} | ${config.mode} | ${formatEnvList(config.required)} | ${formatEnvList(config.optional)} | ${readiness.status} |`,
    );
  }

  const table = lines.join("\n");
  console.log(table);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Live integration configuration\n\n${table}\n\n`,
    );
  }
  if (requireReady && notReady.length > 0) {
    throw new Error(`Live integration providers are not ready:\n- ${notReady.join("\n- ")}`);
  }
}

async function waitFor(description, check, timeoutMs = 120_000) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- Readiness probes must be sequential with delay.
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    // oxlint-disable-next-line no-await-in-loop -- Polling delay is intentional between readiness checks.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError}` : ""}`);
}

function dockerAvailable() {
  const result = spawnSync("docker", ["info"], { encoding: "utf8", stdio: "pipe" });
  return result.status === 0;
}

function dockerPort(containerName, port) {
  const output = run("docker", ["port", containerName, `${port}/tcp`]).trim();
  const first = output.split("\n")[0];
  const mapped = first?.split(":").pop();
  if (!mapped) throw new Error(`Unable to resolve mapped Docker port for ${containerName}:${port}`);
  return mapped;
}

function dockerRun(name, image, dockerArgs, commandArgs = []) {
  spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
  const result = spawnSync(
    "docker",
    ["run", "-d", "--name", name, ...dockerArgs, image, ...commandArgs],
    {
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    throw new Error(`docker run ${image} failed\n${result.stdout}${result.stderr}`);
  }
}

function dockerRm(name) {
  spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
}

async function loadLoggerModules() {
  const [
    { createLogger },
    { elasticTransport },
    { lokiTransport },
    { datadogLogsTransport },
    { cloudWatchLogsTransport, signAwsV4Request },
  ] = await Promise.all([
    import("../packages/core/dist/index.js"),
    import("../packages/elastic/dist/index.js"),
    import("../packages/loki/dist/index.js"),
    import("../packages/datadog/dist/index.js"),
    import("../packages/cloudwatch/dist/index.js"),
  ]);
  return {
    cloudWatchLogsTransport,
    createLogger,
    datadogLogsTransport,
    elasticTransport,
    lokiTransport,
    signAwsV4Request,
  };
}

async function emitLog(transport, message, data = {}, loggerOptions = {}) {
  const { createLogger } = await loadLoggerModules();
  const logger = createLogger({
    logger: "live-integration",
    transports: [transport],
    ...loggerOptions,
  });
  logger.info(message, data);
  await logger.flush();
}

async function smokeElastic() {
  const { elasticTransport } = await loadLoggerModules();
  const runId = `loggerjs-${randomUUID()}`;
  const index = `loggerjs-live-${runId.toLowerCase()}`;
  const message = `loggerjs elastic live ${runId}`;
  let url = optionalEnv("ELASTIC_URL");
  let containerName;

  if (!url) {
    if (!dockerAvailable())
      throw new Error("Docker is required for local Elastic live integration.");
    containerName = `loggerjs-elastic-${runId}`;
    dockerRun(containerName, elasticImage, [
      "-p",
      "127.0.0.1::9200",
      "-e",
      "discovery.type=single-node",
      "-e",
      "xpack.security.enabled=false",
      "-e",
      "ES_JAVA_OPTS=-Xms512m -Xmx512m",
    ]);
    url = `http://127.0.0.1:${dockerPort(containerName, 9200)}`;
  }

  try {
    await waitFor("Elastic HTTP readiness", async () => {
      const response = await fetch(url);
      return response.ok;
    });

    await emitLog(
      elasticTransport({
        apiKey: optionalEnv("ELASTIC_API_KEY"),
        checkBulkErrors: true,
        index,
        refresh: "wait_for",
        url,
      }),
      message,
      { provider: "elastic", runId },
    );

    await waitFor("Elastic indexed log", async () => {
      const response = await fetch(`${url.replace(/\/+$/, "")}/${index}/_search`, {
        body: JSON.stringify({ query: { match_phrase: { message } } }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) return false;
      const body = await response.json();
      return Number(body?.hits?.total?.value ?? 0) > 0;
    });
  } finally {
    if (containerName) dockerRm(containerName);
  }

  console.log("Elastic live integration passed.");
}

async function smokeLoki() {
  const { lokiTransport } = await loadLoggerModules();
  const runId = `loggerjs_${randomUUID().replaceAll("-", "_")}`;
  const message = `loggerjs loki live ${runId}`;
  let url = optionalEnv("LOKI_URL");
  let containerName;

  if (!url) {
    if (!dockerAvailable()) throw new Error("Docker is required for local Loki live integration.");
    containerName = `loggerjs-loki-${runId}`;
    dockerRun(
      containerName,
      lokiImage,
      ["-p", "127.0.0.1::3100"],
      ["-config.file=/etc/loki/local-config.yaml"],
    );
    url = `http://127.0.0.1:${dockerPort(containerName, 3100)}`;
  }

  const baseUrl = url.replace(/\/+$/, "");
  const lokiTenantId = optionalEnv("LOKI_TENANT_ID");
  const headers = lokiTenantId ? { "x-scope-orgid": lokiTenantId } : undefined;

  try {
    await waitFor("Loki readiness", async () => {
      const response = await fetch(`${baseUrl}/ready`, { headers });
      return response.ok;
    });

    const logTime = Date.now();
    const queryStartNs = (BigInt(logTime - 10 * 60_000) * 1_000_000n).toString();
    await emitLog(
      lokiTransport({
        headers,
        labels: { app: "loggerjs-live", run_id: runId },
        structuredMetadata: false,
        tenantId: lokiTenantId,
        url: `${baseUrl}/loki/api/v1/push`,
      }),
      message,
      { provider: "loki", runId },
      { clock: () => logTime },
    );

    const query = encodeURIComponent(`{app="loggerjs-live",run_id="${runId}"}`);
    await waitFor("Loki queried log", async () => {
      const queryEndNs = (BigInt(logTime + 10 * 60_000) * 1_000_000n).toString();
      const response = await fetch(
        `${baseUrl}/loki/api/v1/query_range?query=${query}&start=${queryStartNs}&end=${queryEndNs}&limit=100&direction=forward`,
        { headers },
      );
      const bodyText = await response.text();
      if (!response.ok) {
        throw new Error(`Loki query failed with status ${response.status}: ${bodyText}`);
      }
      if (!bodyText.includes(message)) {
        throw new Error(`Loki query response did not include message: ${bodyText.slice(0, 1_000)}`);
      }
      return true;
    });
  } finally {
    if (containerName) dockerRm(containerName);
  }

  console.log("Loki live integration passed.");
}

async function smokeDatadog() {
  const { datadogLogsTransport } = await loadLoggerModules();
  const runId = `loggerjs-${randomUUID()}`;
  const message = `loggerjs datadog live ${runId}`;
  const service = envOr("DATADOG_SERVICE", "loggerjs-live");
  const site = envOr("DATADOG_SITE", "datadoghq.com");
  const apiKey = requireEnv("DATADOG_API_KEY");
  const appKey = requireEnv("DATADOG_APP_KEY");
  await emitLog(
    datadogLogsTransport({
      apiKey,
      service,
      site,
      source: "loggerjs",
      tags: { provider: "datadog", run_id: runId },
    }),
    message,
    { provider: "datadog", runId },
  );

  const searchUrl =
    optionalEnv("DATADOG_SEARCH_URL") ?? `https://api.${site}/api/v2/logs/events/search`;
  const from = new Date(Date.now() - 10 * 60_000).toISOString();
  const to = new Date(Date.now() + 2 * 60_000).toISOString();
  await waitFor("Datadog searched log", async () => {
    const response = await fetch(searchUrl, {
      body: JSON.stringify({
        filter: {
          from,
          query: `service:${service} run_id:${runId}`,
          to,
        },
        page: { limit: 10 },
        sort: "-timestamp",
      }),
      headers: {
        "content-type": "application/json",
        "dd-api-key": apiKey,
        "dd-application-key": appKey,
      },
      method: "POST",
    });
    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(`Datadog search failed with status ${response.status}: ${bodyText}`);
    }
    return bodyText.includes(message);
  });

  console.log("Datadog live integration passed.");
}

async function smokeCloudWatch() {
  const { cloudWatchLogsTransport, signAwsV4Request } = await loadLoggerModules();
  const region = requireEnv("AWS_REGION");
  const runId = `loggerjs-${randomUUID()}`;
  const message = `loggerjs cloudwatch live ${runId}`;
  const credentials = {
    accessKeyId: requireEnv("AWS_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("AWS_SECRET_ACCESS_KEY"),
    sessionToken: optionalEnv("AWS_SESSION_TOKEN"),
  };
  const endpoint = optionalEnv("CLOUDWATCH_ENDPOINT");
  const logGroupName = requireEnv("CLOUDWATCH_LOG_GROUP");
  const configuredLogStreamName = optionalEnv("CLOUDWATCH_LOG_STREAM");
  const logStreamName = configuredLogStreamName ?? `loggerjs-live-${runId}`;
  const startedAt = Date.now() - 60_000;

  async function cloudWatchRequest(target, body) {
    const url = endpoint ?? `https://logs.${region}.amazonaws.com/`;
    const bodyText = JSON.stringify(body);
    const headers = {
      "content-type": "application/x-amz-json-1.1",
      "x-amz-target": target,
    };
    const signedHeaders = await signAwsV4Request({
      body: bodyText,
      credentials,
      headers,
      method: "POST",
      region,
      service: "logs",
      url,
    });
    const response = await fetch(url, {
      body: bodyText,
      headers: signedHeaders,
      method: "POST",
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(
        `CloudWatch ${target} failed with status ${response.status}: ${responseText}`,
      );
    }
    return responseText ? JSON.parse(responseText) : {};
  }

  if (!configuredLogStreamName) {
    try {
      await cloudWatchRequest("Logs_20140328.CreateLogStream", { logGroupName, logStreamName });
    } catch (error) {
      if (!String(error).includes("ResourceAlreadyExistsException")) throw error;
    }
  }

  await emitLog(
    cloudWatchLogsTransport({
      credentials,
      endpoint,
      logGroupName,
      logStreamName,
      region,
    }),
    message,
    { provider: "cloudwatch", runId },
  );

  await waitFor("CloudWatch queried log", async () => {
    const body = await cloudWatchRequest("Logs_20140328.FilterLogEvents", {
      logGroupName,
      logStreamNames: [logStreamName],
      startTime: startedAt,
    });
    return (body.events ?? []).some((event) => String(event.message ?? "").includes(message));
  });

  console.log("CloudWatch live integration passed.");
}

try {
  if (checkConfig) {
    reportConfig();
    process.exit(0);
  }

  for (const provider of providers) {
    if (provider === "elastic") {
      // oxlint-disable-next-line no-await-in-loop -- Providers intentionally run one at a time for isolated cleanup.
      await smokeElastic();
    } else if (provider === "loki") {
      // oxlint-disable-next-line no-await-in-loop -- Providers intentionally run one at a time for isolated cleanup.
      await smokeLoki();
    } else if (provider === "datadog") {
      // oxlint-disable-next-line no-await-in-loop -- Providers intentionally run one at a time for isolated cleanup.
      await smokeDatadog();
    } else if (provider === "cloudwatch") {
      // oxlint-disable-next-line no-await-in-loop -- Providers intentionally run one at a time for isolated cleanup.
      await smokeCloudWatch();
    } else {
      throw new Error(`Unknown provider: ${provider}`);
    }
  }
} catch (error) {
  reportFailure(error);
  throw error;
}
