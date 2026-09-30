import {
  browserHttpTransport,
  createLogger,
  indexedDbBrowserHttpOfflineQueue,
  indexedDbTransport,
  type Logger,
} from "@loggerjs/browser";

export interface ConservationResult {
  emitted: string[];
  dropped: Array<[id: string, reason: string]>;
  beaconed: string[];
  closeSettled: boolean;
}

export interface IndexedDbQuotaResult {
  emitted: string[];
  persisted: string[];
  dropped: Array<[id: string, reason: string]>;
  closeSettled: boolean;
}

export interface VersionUpgradeResult {
  outcome: "upgraded" | "blocked-timeout";
  wasBlocked: boolean;
}

interface LoggerJsFailureE2eApi {
  runHttpConservation: (options: {
    url: string;
    count: number;
    timeoutMs: number;
    closeBudgetMs: number;
  }) => Promise<ConservationResult>;
  startOfflineLogger: (dbName: string, url: string) => Promise<void>;
  logOffline: (count: number) => Promise<string[]>;
  offlineQueueSize: () => Promise<number>;
  runIndexedDbQuota: (
    dbName: string,
    count: number,
    payloadBytes: number,
  ) => Promise<IndexedDbQuotaResult>;
  holdIndexedDbTransport: (dbName: string) => Promise<void>;
  logToHeldTransport: (message: string) => Promise<"ok" | "rejected">;
  upgradeDatabase: (dbName: string, version: number) => Promise<VersionUpgradeResult>;
}

declare global {
  interface Window {
    loggerjsFailureE2e: LoggerJsFailureE2eApi;
  }
}

function settleWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve(true);
      },
      () => {
        clearTimeout(timer);
        resolve(true);
      },
    );
  });
}

function randomText(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(Math.ceil((length * 3) / 4)));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).slice(0, length);
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    for (const type of ["success", "error", "blocked"]) {
      request.addEventListener(type, () => resolve(), { once: true });
    }
  });
}

// Records events handed to navigator.sendBeacon, which accepts a payload
// without reporting whether it reached the server.
const beaconPayloads: Array<Promise<string[]>> = [];
const originalSendBeacon = navigator.sendBeacon.bind(navigator);
navigator.sendBeacon = (url, data) => {
  const accepted = originalSendBeacon(url, data);
  if (accepted && data instanceof Blob) {
    beaconPayloads.push(
      data
        .text()
        .then((text) => (JSON.parse(text) as Array<{ id: string }>).map((event) => event.id)),
    );
  } else if (accepted && typeof data === "string") {
    beaconPayloads.push(
      Promise.resolve((JSON.parse(data) as Array<{ id: string }>).map((event) => event.id)),
    );
  }
  return accepted;
};

async function takeBeaconedIds(): Promise<string[]> {
  const ids = await Promise.all(beaconPayloads.splice(0));
  return ids.flat();
}

let offlineLogger: Logger | undefined;
let offlineQueue: ReturnType<typeof indexedDbBrowserHttpOfflineQueue> | undefined;
let heldLogger: Logger | undefined;

window.loggerjsFailureE2e = {
  // Emits events through a browserHttpTransport and closes it. Every emitted
  // id is recorded by a second transport that sees the same events.
  async runHttpConservation({ url, count, timeoutMs, closeBudgetMs }) {
    const emitted: string[] = [];
    const dropped: Array<[string, string]> = [];
    const logger = createLogger({
      transports: [
        browserHttpTransport({
          url,
          maxBatchSize: 5,
          flushIntervalMs: 10,
          timeoutMs,
          useBeaconOnPageHide: false,
          onDrop: (event, reason) => dropped.push([event.id, reason]),
        }),
        {
          name: "emitted",
          log: (event) => {
            emitted.push(event.id);
          },
        },
      ],
      onInternalError: () => {},
    });
    for (let index = 0; index < count; index += 1) logger.info("probe", { index });
    // Let a few scheduled flushes meet the faulty collector before closing.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const closeSettled = await settleWithin(logger.close(), closeBudgetMs);
    return { emitted, dropped, beaconed: await takeBeaconedIds(), closeSettled };
  },

  async startOfflineLogger(dbName, url) {
    await deleteDatabase(dbName);
    offlineQueue = indexedDbBrowserHttpOfflineQueue({ dbName });
    offlineLogger = createLogger({
      transports: [
        browserHttpTransport({
          url,
          flushIntervalMs: 0,
          maxBatchSize: 5,
          offlineQueue,
          offlineReplayBaseDelayMs: 10,
          useBeaconOnPageHide: false,
        }),
      ],
      onInternalError: () => {},
    });
  },

  async logOffline(count) {
    if (!offlineLogger) throw new Error("startOfflineLogger() first");
    const messages: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const message = `offline-${index}`;
      messages.push(message);
      offlineLogger.info(message);
    }
    await offlineLogger.flush().catch(() => {});
    return messages;
  },

  async offlineQueueSize() {
    return (await offlineQueue?.size()) ?? 0;
  },

  async runIndexedDbQuota(dbName, count, payloadBytes) {
    await deleteDatabase(dbName);
    const emitted: string[] = [];
    const dropped: Array<[string, string]> = [];
    const transport = indexedDbTransport({
      dbName,
      batchSize: 10,
      flushIntervalMs: 0,
      onDrop: (event, reason) => dropped.push([event.id, reason]),
    });
    const logger = createLogger({
      transports: [
        transport,
        {
          name: "emitted",
          log: (event) => {
            emitted.push(event.id);
          },
        },
      ],
      onInternalError: () => {},
    });
    for (let index = 0; index < count; index += 1) {
      // Random bytes, because browsers compress stored values and a repeated
      // character would never reach the quota.
      logger.info("quota probe", { index, payload: randomText(payloadBytes) });
      // Let each micro-batch reach IndexedDB before the next one.
      // oxlint-disable-next-line no-await-in-loop -- Writes must hit the quota one batch at a time.
      await logger.flush().catch(() => {});
    }
    const persisted: string[] = [];
    try {
      for await (const event of transport.query()) persisted.push(event.id);
    } catch {
      // A database over quota can still be read; ignore a failed trailing flush.
    }
    const closeSettled = await settleWithin(logger.close(), 5_000);
    return { emitted, persisted, dropped, closeSettled };
  },

  async holdIndexedDbTransport(dbName) {
    await deleteDatabase(dbName);
    heldLogger = createLogger({
      transports: [indexedDbTransport({ dbName, flushIntervalMs: 0 })],
      onInternalError: () => {},
    });
    heldLogger.info("holding a connection");
    await heldLogger.flush();
  },

  async logToHeldTransport(message) {
    if (!heldLogger) throw new Error("holdIndexedDbTransport() first");
    heldLogger.info(message);
    return heldLogger.flush().then(
      () => "ok" as const,
      () => "rejected" as const,
    );
  },

  // Opens the database at a newer version, as a newer app build in another
  // tab would, and reports whether an older connection blocked the upgrade.
  upgradeDatabase(dbName, version) {
    return new Promise((resolve) => {
      let wasBlocked = false;
      const request = indexedDB.open(dbName, version);
      const timer = setTimeout(() => resolve({ outcome: "blocked-timeout", wasBlocked }), 3_000);
      request.addEventListener("blocked", () => {
        wasBlocked = true;
      });
      request.addEventListener("success", () => {
        clearTimeout(timer);
        request.result.close();
        resolve({ outcome: "upgraded", wasBlocked });
      });
      request.addEventListener("error", () => {
        clearTimeout(timer);
        resolve({ outcome: "blocked-timeout", wasBlocked });
      });
    });
  },
};
