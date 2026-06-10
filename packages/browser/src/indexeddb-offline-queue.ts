import { incrementLoggerMetaCounter } from "@loggerjs/core";
import type {
  BrowserHttpDropPolicy,
  BrowserHttpOfflineEntry,
  BrowserHttpOfflineQueue,
} from "./http-transport";

export interface IndexedDbBrowserHttpOfflineQueueOptions {
  dbName?: string;
  storeName?: string;
  maxEntries?: number;
  dropPolicy?: BrowserHttpDropPolicy;
  indexedDB?: IDBFactory;
  onDrop?: (entry: BrowserHttpOfflineEntry, reason: string) => void;
}

export interface IndexedDbBrowserHttpOfflineQueue extends BrowserHttpOfflineQueue {
  size: () => Promise<number>;
  clear: () => Promise<void>;
  close: () => void;
}

const DEFAULT_DB_NAME = "loggerjs";
const DEFAULT_STORE_NAME = "browser-http-offline";

function normalizeMaxEntries(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 1000;
  return Math.max(0, Math.floor(value));
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("IndexedDB request failed")),
      { once: true },
    );
  });
}

function compareEntries(a: BrowserHttpOfflineEntry, b: BrowserHttpOfflineEntry): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function orderEntries(entries: BrowserHttpOfflineEntry[]): BrowserHttpOfflineEntry[] {
  const ordered: BrowserHttpOfflineEntry[] = [];
  for (const entry of entries) {
    let index = 0;
    while (
      index < ordered.length &&
      compareEntries(ordered[index] as BrowserHttpOfflineEntry, entry) <= 0
    ) {
      index += 1;
    }
    ordered.splice(index, 0, entry);
  }
  return ordered;
}

export function indexedDbBrowserHttpOfflineQueue(
  options: IndexedDbBrowserHttpOfflineQueueOptions = {},
): IndexedDbBrowserHttpOfflineQueue {
  const dbName = options.dbName ?? DEFAULT_DB_NAME;
  const storeName = options.storeName ?? DEFAULT_STORE_NAME;
  const maxEntries = normalizeMaxEntries(options.maxEntries);
  const dropPolicy = options.dropPolicy ?? "drop-oldest";
  const idb = options.indexedDB ?? globalThis.indexedDB;
  let dbPromise: Promise<IDBDatabase> | undefined;

  const drop = (entry: BrowserHttpOfflineEntry, reason: string) => {
    incrementLoggerMetaCounter("transport.offline.dropped");
    incrementLoggerMetaCounter(`transport.offline.dropped.${reason}`);
    options.onDrop?.(entry, reason);
  };

  const openDb = () => {
    if (!idb) throw new Error("IndexedDB is not available for loggerjs offline queue");
    dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = idb.open(dbName, 1);
      request.addEventListener("upgradeneeded", () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: "id" });
        }
      });
      request.addEventListener("success", () => resolve(request.result), { once: true });
      request.addEventListener(
        "error",
        () => reject(request.error ?? new Error("IndexedDB open failed")),
        { once: true },
      );
    });
    return dbPromise;
  };

  const withStore = async <T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => Promise<T>,
  ): Promise<T> => {
    const db = await openDb();
    const tx = db.transaction(storeName, mode);
    return run(tx.objectStore(storeName));
  };

  const getEntries = async () =>
    orderEntries(
      await withStore("readonly", (store) =>
        requestToPromise(store.getAll() as IDBRequest<BrowserHttpOfflineEntry[]>),
      ),
    );

  const putEntry = (entry: BrowserHttpOfflineEntry) =>
    withStore("readwrite", (store) => requestToPromise(store.put(entry)));

  const deleteEntry = (id: string) =>
    withStore("readwrite", (store) => requestToPromise(store.delete(id)));

  const queue: IndexedDbBrowserHttpOfflineQueue = {
    async enqueue(entry) {
      if (maxEntries === 0) {
        drop(entry, "queue-full");
        return;
      }

      const entries = await getEntries();
      if (entries.length >= maxEntries) {
        if (dropPolicy === "drop-newest") {
          drop(entry, "queue-full");
          return;
        }
        const dropCount = entries.length - maxEntries + 1;
        for (let index = 0; index < dropCount; index += 1) {
          const dropped = entries[index];
          if (!dropped) continue;
          // oxlint-disable-next-line no-await-in-loop -- Drops must be durable before adding the new entry.
          await deleteEntry(dropped.id);
          drop(dropped, "queue-full");
        }
      }

      await putEntry(entry);
    },
    async replay(send) {
      const entries = await getEntries();
      for (const entry of entries) {
        // oxlint-disable-next-line no-await-in-loop -- Replay must preserve order and delete only after send succeeds.
        await send(entry);
        // oxlint-disable-next-line no-await-in-loop -- The entry must remain durable until send resolves.
        await deleteEntry(entry.id);
      }
    },
    async size() {
      return (await getEntries()).length;
    },
    clear() {
      return withStore("readwrite", (store) => requestToPromise(store.clear()));
    },
    close() {
      const promise = dbPromise;
      dbPromise = undefined;
      void promise?.then((db) => db.close());
    },
  };

  return queue;
}
