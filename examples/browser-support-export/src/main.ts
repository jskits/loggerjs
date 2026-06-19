import { createLogger, downloadBlob, exportLogsToZip, indexedDbTransport } from "@loggerjs/browser";
import { privacyGuardProcessor, redactProcessor } from "@loggerjs/processors";

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random()}`;
}

const pageSessionId = `page-${randomId()}`;

const supportStore = indexedDbTransport({
  batchSize: 10,
  dbName: "loggerjs-support-example",
  flushIntervalMs: 2_000,
  localStorageSpill: {
    maxBytes: 128 * 1024,
    maxEntries: 100,
    namespace: "support-example",
  },
  maxEntries: 2_000,
  session: {
    id: pageSessionId,
    contextKey: "sessionId",
  },
  storeName: "support-logs",
});

const logger = createLogger({
  name: "browser-support",
  level: "debug",
  processors: [redactProcessor(), privacyGuardProcessor()],
  tags: { app: "support-export", env: "local" },
  transports: [supportStore],
});

const addButton = document.querySelector<HTMLButtonElement>("#add");
const addErrorButton = document.querySelector<HTMLButtonElement>("#add-error");
const clearButton = document.querySelector<HTMLButtonElement>("#clear");
const exportButton = document.querySelector<HTMLButtonElement>("#export");
const countNode = document.querySelector<HTMLElement>("#count");
const lastExportNode = document.querySelector<HTMLElement>("#last-export");
const previewNode = document.querySelector<HTMLElement>("#preview");
const sessionsNode = document.querySelector<HTMLElement>("#sessions");

async function readRecentMessages(limit = 8): Promise<string[]> {
  const events: string[] = [];
  for await (const event of supportStore.query({ limit, order: "desc" })) {
    events.push(`${event.levelName}: ${event.message}`);
  }
  const ordered: string[] = [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event !== undefined) ordered.push(event);
  }
  return ordered;
}

async function refresh() {
  const [count, sessions, messages] = await Promise.all([
    supportStore.count(),
    supportStore.sessions({ order: "desc" }),
    readRecentMessages(),
  ]);
  if (countNode) countNode.textContent = String(count);
  if (sessionsNode) sessionsNode.textContent = String(sessions.length);
  if (previewNode) previewNode.textContent = JSON.stringify(messages, null, 2);
}

function supportContext() {
  return {
    build: "local",
    sessionId: pageSessionId,
    token: "client-secret",
  };
}

addButton?.addEventListener("click", async () => {
  logger.info("support log captured", {
    action: "manual",
    ...supportContext(),
  });
  await logger.flush();
  await refresh();
});

addErrorButton?.addEventListener("click", async () => {
  logger.error("support error captured", {
    errorCode: "E_DEMO",
    ...supportContext(),
  });
  await logger.flush();
  await refresh();
});

exportButton?.addEventListener("click", async () => {
  await logger.flush();
  const createdAt = Date.now();
  const zip = await exportLogsToZip(supportStore, {
    createdAt,
    groupBySession: true,
    includeRecent: { maxEvents: 50 },
    query: { order: "asc" },
    source: "indexeddb-support-example",
  });
  const filename = `loggerjs-support-${new Date(createdAt).toISOString().replace(/[:.]/g, "-")}.zip`;
  downloadBlob(zip, { filename });
  if (lastExportNode) lastExportNode.textContent = "ZIP";
});

clearButton?.addEventListener("click", async () => {
  await supportStore.clear();
  if (lastExportNode) lastExportNode.textContent = "None";
  await refresh();
});

void refresh();
