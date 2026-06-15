import {
  browserHttpTransport,
  browserServiceWorkerTransport,
  createLogger,
  indexedDbBrowserHttpOfflineQueue,
  type LogEvent,
} from "@loggerjs/browser";

interface BeaconCapture {
  url: string;
  events: LogEvent[];
  body: string;
}

interface ServiceWorkerResult {
  supported: boolean;
  messages: string[];
}

interface LoggerJsE2eApi {
  queueIndexedDbOfflineLog: (dbName: string, message: string) => Promise<number>;
  replayIndexedDbOfflineLog: (dbName: string) => Promise<number>;
  runBeaconPagehide: (message: string) => Promise<BeaconCapture[]>;
  runServiceWorkerTransport: (message: string) => Promise<ServiceWorkerResult>;
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
};
