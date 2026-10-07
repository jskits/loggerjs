# 生产配方

这些配方是生产部署的起点，有意展示了队列上限、隐私 processor、关闭行为以及凭据应该放在哪里。请根据自己的应用调整名称、tags 和端点 URL。

## 浏览器到 HTTP，并用 IndexedDB 离线重放

当浏览器日志需要跨网络中断和普通 reload 存活时使用。浏览器仍然无法保证在 process kill、storage eviction、private browsing restrictions 或 quota exhaustion 下投递成功。

```ts
import {
  browserHttpTransport,
  captureBrowserErrorsIntegration,
  captureConsoleIntegration,
  createLogger,
  indexedDbBrowserHttpOfflineQueue,
  pageLifecycleIntegration,
} from "@loggerjs/browser";
import { captureFetchIntegration } from "@loggerjs/browser/integration-fetch";
import { captureWebVitalsIntegration } from "@loggerjs/browser/integration-web-vitals";
import { privacyGuardProcessor, redactProcessor } from "@loggerjs/processors";

const offlineQueue = indexedDbBrowserHttpOfflineQueue({
  dbName: "checkout-web-http-offline",
  storeName: "http-offline",
  maxEntries: 5000,
  dropPolicy: "drop-oldest",
});

export const logger = createLogger({
  category: ["web"],
  level: "info",
  tags: {
    service: "checkout-web",
    env: "production",
    runtime: "browser",
  },
  processors: [
    redactProcessor({
      keys: ["password", "token", "authorization", "cookie", /secret/i],
    }),
    privacyGuardProcessor({
      maxStringLength: 8192,
    }),
  ],
  transports: [
    browserHttpTransport({
      name: "browser-http",
      url: "/api/logs",
      maxBatchSize: 50,
      flushIntervalMs: 2000,
      maxQueueSize: 2000,
      dropPolicy: "drop-oldest",
      offlineQueue,
      offlineReplayMaxRetries: 3,
      offlineReplayBaseDelayMs: 250,
      offlineReplayMaxDelayMs: 5000,
      useBeaconOnPageHide: true,
      beaconMaxBytes: 60 * 1024,
    }),
  ],
  integrations: [
    captureConsoleIntegration({
      levels: ["warn", "error"],
      captureArguments: false,
      maxCapturesPerSecond: 50,
    }),
    captureBrowserErrorsIntegration({
      captureSecurityPolicyViolation: true,
    }),
    captureFetchIntegration({
      minStatus: 400,
      captureRequestHeaders: ["content-type", "x-request-id"],
      captureResponseHeaders: ["content-type", "x-request-id"],
      sanitizeUrl: (url) => {
        const parsed = new URL(url, location.origin);
        parsed.search = "";
        return parsed.toString();
      },
    }),
    captureWebVitalsIntegration({ flushOnHidden: true }),
    pageLifecycleIntegration(),
  ],
});
```

生产说明：

- `/api/logs` 应该是你自己的收集端点。不要把厂商 API key 打包进浏览器代码。
- fetch/XHR 的 header 采集要使用允许列表。默认不要采集 cookie、authorization header、请求 body 或表单值。
- 如果应用能暴露 logger meta 计数和离线队列深度，请对 `transport.dropped.*` 等指标设置告警。
- HTTP 离线队列的 `dbName` 应与可查询的支持日志存储分开。两者使用各自独立的 IndexedDB 结构和版本生命周期。

## 浏览器支持日志导出（按 session 组织的 IndexedDB）

当技术支持或 QA 需要一份能在刷新后保留、并可按页面 session 导出的本地日志包时使用。这个本地存储与 HTTP 投递队列相互独立：IndexedDB 是可查询的权威数据来源，`localStorageSpill` 只负责保护用户刷新或关闭页面时尚未完成异步 IndexedDB 写入的那一小段尾部日志。

```ts
import { createLogger } from "@loggerjs/core";
import { indexedDbTransport } from "@loggerjs/browser/transport-indexeddb";
import { downloadBlob, exportLogsToZip } from "@loggerjs/browser/export-zip";
import { privacyGuardProcessor, redactProcessor } from "@loggerjs/processors";

const supportStore = indexedDbTransport({
  name: "support-indexeddb",
  dbName: "checkout-web-support-logs",
  storeName: "support-logs",
  maxEntries: 20_000,
  maxBytes: 25 * 1024 * 1024,
  ttlMs: 7 * 24 * 60 * 60 * 1000,
  batchSize: 50,
  flushIntervalMs: 1000,
  durability: "relaxed",
  localStorageSpill: {
    namespace: "checkout-support-logs",
    maxEntries: 200,
    maxBytes: 512 * 1024,
    minLevel: "info",
  },
});

export const supportLogger = createLogger({
  category: ["web"],
  level: "info",
  processors: [
    redactProcessor({
      keys: ["password", "token", "authorization", "cookie", /secret/i],
    }),
    privacyGuardProcessor({ maxStringLength: 8192 }),
  ],
  transports: [supportStore],
});

export async function downloadSupportLogZip() {
  await supportLogger.flush();
  const zip = await exportLogsToZip(supportStore, {
    groupBySession: true,
    includeRecent: { maxEvents: 500 },
    query: {
      from: Date.now() - 7 * 24 * 60 * 60 * 1000,
      order: "asc",
    },
    source: "indexeddb",
  });
  downloadBlob(zip, `checkout-logs-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`);
}
```

生产说明：

- 隐私 processor 必须在 IndexedDB transport 前执行。任何本地持久化内容都可能被用户或 support flow 导出。
- `indexedDbTransport()` 默认创建 page-session id，并在缺失时写入 IndexedDB entry metadata 和 `event.context.sessionId`。如果应用已有 session id，传 `session: { id, getId, contextKey }`。
- `localStorageSpill` 是有上限、尽力而为的最后一道保护。它能改善普通刷新和关闭页面时的表现，但无法防止进程被杀、崩溃、存储被禁用、配额耗尽或存储被驱逐。

## Node 到 Stdout 加 OTLP

把 stdout 作为本地的、平台原生的 sink，把 OTLP 作为远程可观测性路径。即使 OTLP 端点性能下降，stdout 对容器运行时和致命事件依然有用。

```ts
import * as otelApi from "@opentelemetry/api";
import {
  captureProcessIntegration,
  createLogger,
  installAsyncLocalStorageContext,
  stdoutTransport,
} from "@loggerjs/node";
import { openTelemetryTraceProcessor, otlpHttpTransport } from "@loggerjs/otel";
import { redactProcessor } from "@loggerjs/processors";

installAsyncLocalStorageContext();

export const logger = createLogger({
  category: ["api"],
  level: "info",
  tags: {
    service: "checkout-api",
    env: process.env.NODE_ENV ?? "production",
    runtime: "node",
  },
  processors: [
    openTelemetryTraceProcessor({ api: otelApi }),
    redactProcessor({
      keys: ["password", "token", "authorization", "cookie", /secret/i],
    }),
  ],
  transports: [
    stdoutTransport({
      name: "stdout",
      minLength: 4096,
    }),
    otlpHttpTransport({
      name: "otlp",
      url: process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ?? "http://localhost:4318/v1/logs",
      headers: process.env.OTEL_EXPORTER_OTLP_AUTHORIZATION
        ? { authorization: process.env.OTEL_EXPORTER_OTLP_AUTHORIZATION }
        : undefined,
      resource: {
        "service.name": "checkout-api",
        "deployment.environment": process.env.NODE_ENV ?? "production",
      },
      maxRecords: 100,
      maxWaitMs: 2000,
      maxQueueSize: 5000,
      maxRetries: 3,
      circuitBreakerFailureThreshold: 5,
      circuitBreakerResetMs: 30000,
    }),
  ],
  integrations: [
    captureProcessIntegration({
      exitOnUncaught: true,
      flushTimeoutMs: 500,
    }),
  ],
});

export async function closeLogger() {
  await logger.close();
}
```

生产说明：

- 至少为致命的进程路径保留一个本地 sink（`stdoutTransport()` 或 `fileTransport()`）。远程 OTLP 不应是崩溃路径上唯一的 sink。
- 需要关联活跃 span 时，在创建 logger 之前安装 `@opentelemetry/api` 并初始化 tracing。
- 使用部署平台的 graceful shutdown hook 调用 `logger.close()`。

## 全栈投递到 Loki 和 Datadog

当浏览器和服务端日志需要汇入同一套厂商后端时使用。浏览器把日志发送到你自己的收集端；服务端持有 Loki 和 Datadog 的凭据，并同时转发服务端事件和已接收的浏览器批次。

```ts
import {
  batchTransport,
  createLogger,
  recordToEvent,
  type LogEvent,
  type Transport,
  type TransportContext,
} from "@loggerjs/core";
import { datadogLogsTransport } from "@loggerjs/datadog";
import { lokiTransport } from "@loggerjs/loki";
import { redactProcessor } from "@loggerjs/processors";

const service = "checkout";
const env = process.env.NODE_ENV ?? "production";

function reliableVendorTransport(transport: Transport): Transport {
  return batchTransport(transport, {
    maxRecords: 100,
    maxWaitMs: 2000,
    maxQueueSize: 10000,
    dropPolicy: "drop-oldest",
    maxRetries: 3,
    retryBaseDelayMs: 250,
    retryMaxDelayMs: 5000,
    circuitBreakerFailureThreshold: 5,
    circuitBreakerResetMs: 30000,
  });
}

const vendorTransports = [
  reliableVendorTransport(
    lokiTransport({
      url: process.env.LOKI_URL ?? "http://localhost:3100/loki/api/v1/push",
      tenantId: process.env.LOKI_TENANT_ID,
      labels: { service, env },
      labelTags: ["runtime"],
      structuredMetadata: true,
    }),
  ),
  reliableVendorTransport(
    datadogLogsTransport({
      apiKey: process.env.DD_API_KEY,
      site: process.env.DD_SITE ?? "datadoghq.com",
      service,
      source: "loggerjs",
      tags: { env },
      eventTagKeys: ["runtime"],
    }),
  ),
];

export const serverLogger = createLogger({
  category: ["api"],
  level: "info",
  tags: { service, env, runtime: "node" },
  processors: [
    redactProcessor({
      keys: ["password", "token", "authorization", "cookie", /secret/i],
    }),
  ],
  transports: vendorTransports,
});

const collectorContext: TransportContext = {
  loggerName: "browser-log-collector",
  now: () => Date.now(),
  toEvent: recordToEvent,
  reportInternalError(error, detail) {
    serverLogger.warn("browser log collector failed", { error, detail });
  },
};

export async function forwardBrowserLogs(events: LogEvent[]) {
  for (const transport of vendorTransports) {
    if (transport.logBatch) await transport.logBatch(events, collectorContext);
    else {
      for (const event of events) await transport.log?.(event, collectorContext);
    }
  }
}
```

生产说明：

- 调用 `forwardBrowserLogs()` 前验证并限制 `/api/logs` request body。过大的 batches 应尽早拒绝。
- 只把低基数字段提升为 Loki 标签和 Datadog tags。用户 id、请求 id、订单 id 和 URL 应放在结构化元数据或 data 中。
- 浏览器和服务端 collector 使用同一套 redaction policy。把 browser-submitted logs 视为不可信输入。
