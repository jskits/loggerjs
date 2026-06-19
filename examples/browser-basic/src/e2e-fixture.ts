import {
  browserHttpTransport,
  browserServiceWorkerTransport,
  createLogger,
  exportLogsToZip,
  indexedDbBrowserHttpOfflineQueue,
  indexedDbTransport,
  type LogEvent,
} from "@loggerjs/browser";

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const SUPPORT_LOG_STORE = "support-logs";
const SPILL_KEY_PREFIX = "loggerjs:spill:v1:";

interface BeaconCapture {
  url: string;
  events: LogEvent[];
  body: string;
}

interface SupportExportManifestSession {
  logCount?: number;
  logFileName?: string;
  sessionId?: string;
}

interface SupportExportManifest {
  logCount?: number;
  recentLogFileName?: string;
  sessionCount?: number;
  sessions?: SupportExportManifestSession[];
}

interface SupportExportResult {
  files: Record<string, string>;
  manifest: SupportExportManifest;
  queriedMessages: string[];
  recentMessages: string[];
  sessionFiles: string[];
  sessionIds: string[];
}

interface SupportSpillDrainResult {
  drainedMessages: string[];
  sessionIds: string[];
  storageAfterDrain: string | null;
}

interface ServiceWorkerResult {
  supported: boolean;
  messages: string[];
}

interface LoggerJsE2eApi {
  drainIndexedDbSupportSpill: (
    dbName: string,
    namespace: string,
  ) => Promise<SupportSpillDrainResult>;
  queueIndexedDbOfflineLog: (dbName: string, message: string) => Promise<number>;
  replayIndexedDbOfflineLog: (dbName: string) => Promise<number>;
  runBeaconPagehide: (message: string) => Promise<BeaconCapture[]>;
  runIndexedDbSupportExport: (
    dbName: string,
    sessionId: string,
    messagePrefix: string,
  ) => Promise<SupportExportResult>;
  runServiceWorkerTransport: (message: string) => Promise<ServiceWorkerResult>;
  writeIndexedDbSupportSpill: (
    dbName: string,
    namespace: string,
    message: string,
  ) => Promise<string[]>;
}

declare global {
  interface Window {
    loggerjsE2e: LoggerJsE2eApi;
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseLogEvents(body: string): LogEvent[] {
  const parsed = JSON.parse(body) as LogEvent | LogEvent[];
  return Array.isArray(parsed) ? parsed : [parsed];
}

function parseNdjsonLogEvents(body: string | undefined): LogEvent[] {
  if (!body) return [];
  return body
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as LogEvent);
}

function spillKey(namespace: string): string {
  return `${SPILL_KEY_PREFIX}${namespace}`;
}

function spillMessages(namespace: string): string[] {
  const raw = localStorage.getItem(spillKey(namespace));
  if (!raw) return [];
  const parsed = JSON.parse(raw) as { entries?: LogEvent[] };
  return Array.isArray(parsed.entries) ? parsed.entries.map((event) => event.message) : [];
}

async function readStoredZip(blob: Blob): Promise<Record<string, string>> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const files: Record<string, string> = {};
  let offset = 0;

  while (offset + 4 <= bytes.byteLength) {
    const signature = view.getUint32(offset, true);
    if (signature !== LOCAL_FILE_HEADER_SIGNATURE) break;

    const method = view.getUint16(offset + 8, true);
    if (method !== 0) throw new Error(`Unexpected ZIP compression method ${method}`);

    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const nameEnd = nameStart + nameLength;
    const contentStart = nameEnd + extraLength;
    const contentEnd = contentStart + size;

    files[decoder.decode(bytes.slice(nameStart, nameEnd))] = decoder.decode(
      bytes.slice(contentStart, contentEnd),
    );
    offset = contentEnd;
  }

  return files;
}

async function collectEvents(source: AsyncIterable<LogEvent>): Promise<LogEvent[]> {
  const events: LogEvent[] = [];
  for await (const event of source) events.push(event);
  return events;
}

async function bodyToText(body: unknown): Promise<string> {
  if (body instanceof Blob) return body.text();
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  if (ArrayBuffer.isView(body)) return new TextDecoder().decode(body);
  return String(body ?? "");
}

function deleteDatabase(dbName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(dbName);
    request.addEventListener("success", () => resolve(), { once: true });
    request.addEventListener("blocked", () => resolve(), { once: true });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error(`Unable to delete IndexedDB ${dbName}`)),
      { once: true },
    );
  });
}

async function waitFor<T>(
  read: () => T | undefined | Promise<T | undefined>,
  description: string,
): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    // oxlint-disable-next-line no-await-in-loop -- Polling must observe one browser-side state snapshot at a time.
    const value = await read();
    if (value !== undefined) return value;
    // oxlint-disable-next-line no-await-in-loop -- Intentional polling delay.
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

window.loggerjsE2e = {
  async drainIndexedDbSupportSpill(dbName, namespace) {
    const supportStore = indexedDbTransport({
      dbName,
      localStorageSpill: {
        namespace,
        storage: localStorage,
      },
      session: { id: "drain-session" },
      storeName: SUPPORT_LOG_STORE,
    });

    const drainedEvents = await collectEvents(supportStore.query({ order: "asc" }));
    const sessions = await supportStore.sessions({ order: "asc" });
    const storageAfterDrain = localStorage.getItem(spillKey(namespace));
    await supportStore.close?.();
    await deleteDatabase(dbName);
    localStorage.removeItem(spillKey(namespace));

    return {
      drainedMessages: drainedEvents.map((event) => event.message),
      sessionIds: sessions.map((session) => session.sessionId),
      storageAfterDrain,
    };
  },

  async queueIndexedDbOfflineLog(dbName, message) {
    await deleteDatabase(dbName);
    const offlineQueue = indexedDbBrowserHttpOfflineQueue({
      dbName,
      storeName: "http-offline",
    });
    const transport = browserHttpTransport({
      url: "/api/e2e-persistent-logs",
      flushIntervalMs: 60_000,
      maxBatchSize: 100,
      offlineQueue,
      useBeaconOnPageHide: false,
    });
    const logger = createLogger({
      category: ["e2e", "persistent"],
      transports: [transport],
    });

    logger.info(message, { phase: "queued" });
    await logger.flush();
    const size = await waitFor(async () => {
      const currentSize = await offlineQueue.size();
      return currentSize === 1 ? currentSize : undefined;
    }, "IndexedDB offline queue enqueue");
    await logger.close();
    offlineQueue.close();
    return size;
  },

  async replayIndexedDbOfflineLog(dbName) {
    const offlineQueue = indexedDbBrowserHttpOfflineQueue({
      dbName,
      storeName: "http-offline",
    });
    const transport = browserHttpTransport({
      url: "/api/e2e-persistent-logs",
      offlineQueue,
      useBeaconOnPageHide: false,
    });

    window.dispatchEvent(new Event("online"));
    await waitFor(async () => {
      const size = await offlineQueue.size();
      return size === 0 ? size : undefined;
    }, "IndexedDB offline queue replay");

    const size = await offlineQueue.size();
    await transport.close?.();
    offlineQueue.close();
    return size;
  },

  async runBeaconPagehide(message) {
    const originalSendBeacon = navigator.sendBeacon.bind(navigator);
    const captures: Array<Promise<BeaconCapture>> = [];

    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value(url: string | URL, body?: BodyInit | null) {
        const captured = bodyToText(body).then((bodyText) => ({
          body: bodyText,
          events: parseLogEvents(bodyText),
          url: String(url),
        }));
        captures.push(captured);
        return true;
      },
    });

    try {
      const logger = createLogger({
        category: ["e2e", "beacon"],
        transports: [
          browserHttpTransport({
            url: "/api/e2e-beacon-logs",
            flushIntervalMs: 60_000,
            maxBatchSize: 100,
            useBeaconOnPageHide: true,
          }),
        ],
      });

      logger.info(message, { phase: "pagehide" });
      window.dispatchEvent(new PageTransitionEvent("pagehide"));
      await waitFor(() => (captures.length > 0 ? true : undefined), "sendBeacon capture");
      await logger.close();
      return Promise.all(captures);
    } finally {
      Object.defineProperty(navigator, "sendBeacon", {
        configurable: true,
        value: originalSendBeacon,
      });
    }
  },

  async runIndexedDbSupportExport(dbName, sessionId, messagePrefix) {
    const namespace = `${dbName}:${SUPPORT_LOG_STORE}:export`;
    const firstMessage = `${messagePrefix} first`;
    const secondMessage = `${messagePrefix} second`;
    await deleteDatabase(dbName);
    localStorage.removeItem(spillKey(namespace));

    const supportStore = indexedDbTransport({
      batchSize: 2,
      dbName,
      flushIntervalMs: 60_000,
      localStorageSpill: {
        namespace,
        storage: localStorage,
      },
      session: { id: sessionId },
      storeName: SUPPORT_LOG_STORE,
    });
    const logger = createLogger({
      category: ["e2e", "support-export"],
      transports: [supportStore],
    });

    logger.info(firstMessage, { phase: "support-export" });
    logger.warn(secondMessage, { phase: "support-export" });
    await logger.flush();

    const queriedEvents = await collectEvents(supportStore.query({ order: "asc", sessionId }));
    const sessions = await supportStore.sessions({ order: "asc" });
    const zip = await exportLogsToZip(supportStore, {
      createdAt: 1_700_000_000_000,
      groupBySession: true,
      includeRecent: { maxEvents: 2 },
      query: { order: "asc", sessionId },
      source: "indexeddb-support-e2e",
    });
    const files = await readStoredZip(zip);
    const manifest = JSON.parse(files["manifest.json"] ?? "{}") as SupportExportManifest;
    const recentMessages = parseNdjsonLogEvents(
      manifest.recentLogFileName ? files[manifest.recentLogFileName] : undefined,
    ).map((event) => event.message);

    await logger.close();
    await deleteDatabase(dbName);
    localStorage.removeItem(spillKey(namespace));

    return {
      files,
      manifest,
      queriedMessages: queriedEvents.map((event) => event.message),
      recentMessages,
      sessionFiles: Object.keys(files).filter((name) => name.startsWith("sessions/")),
      sessionIds: sessions.map((session) => session.sessionId),
    };
  },

  async runServiceWorkerTransport(message) {
    if (!("serviceWorker" in navigator)) return { messages: [], supported: false };

    const messages: string[] = [];
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { message?: unknown; type?: unknown };
      if (data?.type === "loggerjs.e2e.seen" && typeof data.message === "string") {
        messages.push(data.message);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);

    const registration = await navigator.serviceWorker.register("/loggerjs-e2e-sw.js", {
      scope: "/",
    });

    try {
      await navigator.serviceWorker.ready;
      const transport = browserServiceWorkerTransport({
        source: "loggerjs-e2e",
        target: "ready",
      });
      const logger = createLogger({
        category: ["e2e", "service-worker"],
        transports: [transport],
      });

      await logger.ready();
      logger.info(message, { phase: "service-worker" });
      await waitFor(
        () => (messages.includes(message) ? message : undefined),
        "service worker transport message",
      );
      await logger.close();
      return { messages, supported: true };
    } finally {
      navigator.serviceWorker.removeEventListener("message", onMessage);
      await registration.unregister();
    }
  },

  async writeIndexedDbSupportSpill(dbName, namespace, message) {
    await deleteDatabase(dbName);
    localStorage.removeItem(spillKey(namespace));

    const supportStore = indexedDbTransport({
      batchSize: 100,
      dbName,
      flushIntervalMs: 60_000,
      flushOnPageHide: false,
      localStorageSpill: {
        namespace,
        storage: localStorage,
      },
      session: { id: "spill-session" },
      storeName: SUPPORT_LOG_STORE,
    });
    const logger = createLogger({
      category: ["e2e", "support-spill"],
      transports: [supportStore],
    });

    logger.info(message, { phase: "spill" });
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    return spillMessages(namespace);
  },
};
