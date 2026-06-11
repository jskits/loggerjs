import {
  incrementLoggerMetaCounter,
  safeJsonCodec,
  toLevelValue,
  type Codec,
  type LogEvent,
  type LoggerLevel,
  type Transport,
  type TransportContext,
} from "@loggerjs/core";
import type { BrowserHttpDropPolicy } from "./http-transport";

export interface IndexedDbLogEntry {
  id: string;
  seq: number;
  createdAt: number;
  level: number;
  levelName: string;
  logger: string;
  type?: string;
  byteLength: number;
  payload: string | Uint8Array;
}

export interface IndexedDbTransportQueryOptions {
  from?: number;
  to?: number;
  minLevel?: LoggerLevel;
  logger?: string;
  type?: string;
  limit?: number;
  order?: "asc" | "desc";
}

export interface IndexedDbTransportOptions {
  name?: string;
  dbName?: string;
  storeName?: string;
  maxEntries?: number;
  maxBytes?: number;
  ttlMs?: number;
  batchSize?: number;
  flushIntervalMs?: number;
  maxBufferSize?: number;
  dropPolicy?: BrowserHttpDropPolicy;
  flushOnPageHide?: boolean;
  codec?: Codec<string | Uint8Array>;
  minLevel?: LoggerLevel;
  indexedDB?: IDBFactory;
  onDrop?: (event: LogEvent, reason: string) => void;
  onPersistedDrop?: (entry: IndexedDbLogEntry, reason: string) => void;
}

export interface IndexedDbTransport extends Transport {
  count: () => Promise<number>;
  clear: () => Promise<void>;
  query: (options?: IndexedDbTransportQueryOptions) => AsyncIterable<LogEvent>;
}

const DEFAULT_DB_NAME = "loggerjs";
const DEFAULT_STORE_NAME = "logs";

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
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

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener(
      "abort",
      () => reject(transaction.error ?? new Error("IndexedDB transaction aborted")),
      { once: true },
    );
    transaction.addEventListener(
      "error",
      () => reject(transaction.error ?? new Error("IndexedDB transaction failed")),
      { once: true },
    );
  });
}

function payloadByteLength(payload: string | Uint8Array): number {
  if (typeof payload !== "string") return payload.byteLength;
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(payload).byteLength;
  return new Blob([payload]).size;
}

function compareEntries(a: IndexedDbLogEntry, b: IndexedDbLogEntry): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  if (a.seq !== b.seq) return a.seq - b.seq;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function orderEntries(
  entries: readonly IndexedDbLogEntry[],
  order: "asc" | "desc" = "asc",
): IndexedDbLogEntry[] {
  // oxlint-disable-next-line no-array-sort -- Sort a copy to preserve ES2020 compatibility and caller immutability.
  const sorted = [...entries].sort(compareEntries);
  if (order === "asc") return sorted;
  const reversed: IndexedDbLogEntry[] = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    reversed.push(sorted[index] as IndexedDbLogEntry);
  }
  return reversed;
}

function indexExists(store: IDBObjectStore, name: string): boolean {
  return store.indexNames.contains(name);
}

function ensureIndex(store: IDBObjectStore, name: string, keyPath: string) {
  if (!indexExists(store, name)) store.createIndex(name, keyPath);
}

function decodeEntry(
  entry: IndexedDbLogEntry,
  codec: Codec<string | Uint8Array>,
): LogEvent | undefined {
  if (!codec.decode) throw new Error("indexedDbTransport query requires a codec with decode");
  const decoded = codec.decode(entry.payload);
  return Array.isArray(decoded) ? decoded[0] : decoded;
}

function shouldKeepEntry(entry: IndexedDbLogEntry, options: IndexedDbTransportQueryOptions) {
  if (options.from !== undefined && entry.createdAt < options.from) return false;
  if (options.to !== undefined && entry.createdAt > options.to) return false;
  if (options.minLevel !== undefined && entry.level < toLevelValue(options.minLevel)) return false;
  if (options.logger !== undefined && entry.logger !== options.logger) return false;
  if (options.type !== undefined && entry.type !== options.type) return false;
  return true;
}

export function indexedDbTransport(options: IndexedDbTransportOptions = {}): IndexedDbTransport {
  const dbName = options.dbName ?? DEFAULT_DB_NAME;
  const storeName = options.storeName ?? DEFAULT_STORE_NAME;
  const codec = options.codec ?? (safeJsonCodec() as Codec<string | Uint8Array>);
  const batchSize = normalizePositiveInteger(options.batchSize, 100);
  const flushIntervalMs = normalizePositiveInteger(options.flushIntervalMs, 1000);
  const maxBufferSize = normalizePositiveInteger(options.maxBufferSize, 1000);
  const maxEntries = normalizePositiveInteger(options.maxEntries, 50_000);
  const maxBytes = normalizePositiveInteger(options.maxBytes, 50 * 1024 * 1024);
  const dropPolicy = options.dropPolicy ?? "drop-oldest";
  const idb = options.indexedDB ?? globalThis.indexedDB;
  const flushOnPageHide = options.flushOnPageHide ?? true;

  const buffer: LogEvent[] = [];
  let dbPromise: Promise<IDBDatabase> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let flushPromise: Promise<void> | undefined;
  let lastContext: TransportContext | undefined;
  let closed = false;

  const reportInternalError = (error: unknown, operation: string) => {
    lastContext?.reportInternalError(error, {
      operation,
      phase: "transport",
      transport: options.name ?? "indexeddb",
    });
  };

  const dropEvent = (event: LogEvent, reason: string) => {
    incrementLoggerMetaCounter("transport.indexeddb.dropped");
    incrementLoggerMetaCounter(`transport.indexeddb.dropped.${reason}`);
    options.onDrop?.(event, reason);
  };

  const dropPersistedEntry = (entry: IndexedDbLogEntry, reason: string) => {
    incrementLoggerMetaCounter("transport.indexeddb.persisted.dropped");
    incrementLoggerMetaCounter(`transport.indexeddb.persisted.dropped.${reason}`);
    options.onPersistedDrop?.(entry, reason);
  };

  const openDb = () => {
    if (!idb) throw new Error("IndexedDB is not available for indexedDbTransport");
    dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = idb.open(dbName, 1);
      request.addEventListener("upgradeneeded", () => {
        const db = request.result;
        const store = db.objectStoreNames.contains(storeName)
          ? request.transaction?.objectStore(storeName)
          : db.createObjectStore(storeName, { keyPath: "id" });
        if (!store) return;
        ensureIndex(store, "createdAt", "createdAt");
        ensureIndex(store, "level", "level");
        ensureIndex(store, "logger", "logger");
        ensureIndex(store, "type", "type");
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
    run: (store: IDBObjectStore, transaction: IDBTransaction) => T | Promise<T>,
  ): Promise<T> => {
    const db = await openDb();
    const tx = db.transaction(storeName, mode);
    const settled = transactionToPromise(tx);
    try {
      const result = await run(tx.objectStore(storeName), tx);
      await settled;
      return result;
    } catch (error) {
      if (tx.error === null) {
        try {
          tx.abort();
        } catch {
          // The transaction may already be committed or aborted.
        }
      }
      throw error;
    }
  };

  const getEntries = async () =>
    orderEntries(
      await withStore("readonly", (store) =>
        requestToPromise(store.getAll() as IDBRequest<IndexedDbLogEntry[]>),
      ),
    );

  const deleteEntries = async (entries: readonly IndexedDbLogEntry[], reason: string) => {
    if (entries.length === 0) return;
    await withStore("readwrite", async (store) => {
      for (const entry of entries) {
        // oxlint-disable-next-line no-await-in-loop -- Deletes are sequenced for fake IDB compatibility.
        await requestToPromise(store.delete(entry.id));
        dropPersistedEntry(entry, reason);
      }
    });
  };

  const prune = async () => {
    const now = Date.now();
    let entries = await getEntries();
    const expired =
      options.ttlMs === undefined
        ? []
        : entries.filter((entry) => now - entry.createdAt > (options.ttlMs as number));
    if (expired.length > 0) {
      await deleteEntries(expired, "ttl");
      const expiredIds = new Set(expired.map((entry) => entry.id));
      entries = entries.filter((entry) => !expiredIds.has(entry.id));
    }

    if (maxEntries >= 0 && entries.length > maxEntries) {
      const dropped = entries.slice(0, entries.length - maxEntries);
      await deleteEntries(dropped, "max-entries");
      entries = entries.slice(entries.length - maxEntries);
    }

    if (maxBytes >= 0) {
      let total = entries.reduce((sum, entry) => sum + entry.byteLength, 0);
      const dropped: IndexedDbLogEntry[] = [];
      for (const entry of entries) {
        if (total <= maxBytes) break;
        total -= entry.byteLength;
        dropped.push(entry);
      }
      await deleteEntries(dropped, "max-bytes");
    }
  };

  const eventToEntry = (event: LogEvent): IndexedDbLogEntry => {
    const payload = codec.encode(event);
    return {
      id: event.id,
      seq: event.seq,
      createdAt: event.time,
      level: event.level,
      levelName: event.levelName,
      logger: event.logger,
      type: event.type,
      byteLength: payloadByteLength(payload),
      payload,
    };
  };

  const writeBatch = async (events: readonly LogEvent[]) => {
    if (events.length === 0) return;
    const entries = events.map(eventToEntry);
    await withStore("readwrite", (store) => {
      for (const entry of entries) {
        store.put(entry);
      }
    });
    incrementLoggerMetaCounter("transport.indexeddb.persisted", entries.length);
    await prune();
  };

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };

  const flushPending = async () => {
    if (flushPromise) return flushPromise;
    clearTimer();
    const batch = buffer.splice(0, buffer.length);
    flushPromise = writeBatch(batch).finally(() => {
      flushPromise = undefined;
      if (buffer.length > 0 && !closed) schedule();
    });
    return flushPromise;
  };

  const schedule = () => {
    if (timer || flushIntervalMs <= 0 || closed) return;
    timer = setTimeout(() => {
      void flushPending().catch((error: unknown) => reportInternalError(error, "flush"));
    }, flushIntervalMs);
  };

  const onPageHide = () => {
    void flushPending().catch((error: unknown) => reportInternalError(error, "pagehide-flush"));
  };

  const onVisibilityChange = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      void flushPending().catch((error: unknown) => reportInternalError(error, "visibility-flush"));
    }
  };

  if (flushOnPageHide) {
    globalThis.addEventListener?.("pagehide", onPageHide);
    globalThis.addEventListener?.("visibilitychange", onVisibilityChange);
  }

  return {
    name: options.name ?? "indexeddb",
    minLevel: options.minLevel,
    log(event, context) {
      if (closed) return;
      if (options.minLevel !== undefined && event.level < toLevelValue(options.minLevel)) return;
      lastContext = context;
      if (maxBufferSize === 0 || buffer.length >= maxBufferSize) {
        if (dropPolicy === "drop-newest") {
          dropEvent(event, "buffer-full");
          return;
        }
        const dropped = buffer.shift();
        if (dropped) dropEvent(dropped, "buffer-full");
      }
      buffer.push(event);
      if (buffer.length >= batchSize || flushIntervalMs === 0) {
        void flushPending().catch((error: unknown) => reportInternalError(error, "flush"));
      } else {
        schedule();
      }
    },
    flush() {
      return flushPending();
    },
    async count() {
      await flushPending();
      return (await getEntries()).length;
    },
    async clear() {
      buffer.length = 0;
      clearTimer();
      await withStore("readwrite", (store) => requestToPromise(store.clear()));
    },
    async *query(queryOptions: IndexedDbTransportQueryOptions = {}) {
      await flushPending();
      const entries = orderEntries(await getEntries(), queryOptions.order ?? "asc")
        .filter((entry) => shouldKeepEntry(entry, queryOptions))
        .slice(0, queryOptions.limit);
      for (const entry of entries) {
        const event = decodeEntry(entry, codec);
        if (event) yield event;
      }
    },
    close() {
      closed = true;
      clearTimer();
      globalThis.removeEventListener?.("pagehide", onPageHide);
      globalThis.removeEventListener?.("visibilitychange", onVisibilityChange);
      const flushed = flushPending();
      const promise = dbPromise;
      dbPromise = undefined;
      return flushed.finally(() => {
        void promise?.then((db) => db.close());
      });
    },
  };
}
