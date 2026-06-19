import {
  incrementLoggerMetaCounter,
  safeJsonCodec,
  safeJsonStringify,
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
  sessionId?: string;
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
  sessionId?: string;
  minLevel?: LoggerLevel;
  logger?: string;
  type?: string;
  limit?: number;
  order?: "asc" | "desc";
}

export type IndexedDbTransportDurability = "default" | "strict" | "relaxed";

export type IndexedDbStorageBucketDurability = "strict" | "relaxed";

export interface IndexedDbTransportSessionOptions {
  id?: string;
  getId?: (event: LogEvent) => string | undefined;
  contextKey?: string;
}

export type IndexedDbTransportSession = string | false | IndexedDbTransportSessionOptions;

export interface IndexedDbLogSession {
  sessionId: string;
  firstSeen: number;
  lastSeen: number;
  count: number;
  byteLength: number;
}

export interface IndexedDbTransportSessionQueryOptions {
  limit?: number;
  order?: "asc" | "desc";
}

export interface IndexedDbLocalStorageSpillOptions {
  namespace?: string;
  maxEntries?: number;
  maxBytes?: number;
  maxOriginBytes?: number;
  minLevel?: LoggerLevel;
  drainOnCreate?: boolean;
  spillOnPageHide?: boolean;
  storage?: Storage;
  onDrop?: (event: LogEvent, reason: string) => void;
}

export interface IndexedDbTransportStats {
  bufferDepth: number;
  maxBufferDepth: number;
  pendingFlush: boolean;
  enqueued: number;
  persisted: number;
  dropped: number;
  droppedByReason: Record<string, number>;
  persistedDropped: number;
  persistedDroppedByReason: Record<string, number>;
  flushes: number;
  flushErrors: number;
  lastFlushBatchSize: number;
  lastFlushDurationMs: number;
  prunes: number;
  pruneFallbacks: number;
  lastPruneDurationMs: number;
  queries: number;
  queryFallbacks: number;
  lastQueryDurationMs: number;
  databaseOpenCount: number;
  storageBucketFallbacks: number;
  transactionOptionFallbacks: number;
  errors: number;
  errorsByOperation: Record<string, number>;
  localStorageSpillWrites: number;
  localStorageSpillEntries: number;
  localStorageSpillDrains: number;
  localStorageSpillDrainedEntries: number;
  localStorageSpillDropped: number;
  localStorageSpillDroppedByReason: Record<string, number>;
  localStorageSpillErrors: number;
  localStorageSpillErrorsByOperation: Record<string, number>;
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
  durability?: IndexedDbTransportDurability;
  storageBucketName?: string;
  storageBucketPersisted?: boolean;
  storageBucketDurability?: IndexedDbStorageBucketDurability;
  session?: IndexedDbTransportSession;
  localStorageSpill?: false | IndexedDbLocalStorageSpillOptions;
  indexedDB?: IDBFactory;
  onDrop?: (event: LogEvent, reason: string) => void;
  onPersistedDrop?: (entry: IndexedDbLogEntry, reason: string) => void;
}

export interface IndexedDbTransport extends Transport {
  count: () => Promise<number>;
  clear: () => Promise<void>;
  remove: (ids: string | readonly string[]) => Promise<void>;
  query: (options?: IndexedDbTransportQueryOptions) => AsyncIterable<LogEvent>;
  sessions: (options?: IndexedDbTransportSessionQueryOptions) => Promise<IndexedDbLogSession[]>;
  stats: () => IndexedDbTransportStats;
}

const DEFAULT_DB_NAME = "loggerjs";
const DEFAULT_STORE_NAME = "logs";
const DEFAULT_SESSION_CONTEXT_KEY = "sessionId";
const DEFAULT_SPILL_MAX_ENTRIES = 200;
const DEFAULT_SPILL_MAX_BYTES = 512 * 1024;
const DEFAULT_SPILL_MAX_ORIGIN_BYTES = 5 * 1024 * 1024;
const DB_VERSION = 3;
const ORDER_INDEX_NAME = "createdAtSeq";
const SESSION_INDEX_NAME = "sessionId";
const SESSION_ORDER_INDEX_NAME = "sessionIdCreatedAtSeq";
const SPILL_SCHEMA = "loggerjs.indexeddb-spill.v1";

interface NormalizedSessionOptions {
  id?: string;
  getId?: (event: LogEvent) => string | undefined;
  contextKey: string;
}

interface NormalizedLocalStorageSpillOptions {
  key: string;
  maxEntries: number;
  maxBytes: number;
  maxOriginBytes: number;
  minLevelValue?: number;
  drainOnCreate: boolean;
  spillOnPageHide: boolean;
  storage: Storage;
  onDrop?: (event: LogEvent, reason: string) => void;
}

interface LocalStorageSpillPayload {
  schema: typeof SPILL_SCHEMA;
  createdAt: number;
  entries: readonly LogEvent[];
}

interface LocalStorageSpillClearCandidate {
  value: string;
  pendingIds: Set<string>;
}

interface StorageBucketLike {
  indexedDB?: IDBFactory;
}

interface StorageBucketManagerLike {
  open: (
    name: string,
    options?: {
      durability?: IndexedDbStorageBucketDurability;
      persisted?: boolean;
    },
  ) => Promise<StorageBucketLike>;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

let fallbackSessionSeq = 0;

function defaultPageSessionId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (randomUUID) return randomUUID.call(globalThis.crypto);
  return `${Date.now().toString(36)}-${(fallbackSessionSeq++).toString(36)}`;
}

function normalizeSessionId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeSessionOptions(
  session: IndexedDbTransportSession | undefined,
): NormalizedSessionOptions | undefined {
  if (session === false) return undefined;
  if (typeof session === "string") {
    return {
      contextKey: DEFAULT_SESSION_CONTEXT_KEY,
      id: normalizeSessionId(session) ?? defaultPageSessionId(),
    };
  }
  return {
    contextKey: session?.contextKey ?? DEFAULT_SESSION_CONTEXT_KEY,
    getId: session?.getId,
    id: normalizeSessionId(session?.id) ?? defaultPageSessionId(),
  };
}

function resolveLocalStorage(storage: Storage | undefined): Storage | undefined {
  if (storage) return storage;
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function normalizeLocalStorageSpillOptions(
  spill: false | IndexedDbLocalStorageSpillOptions | undefined,
  dbName: string,
  storeName: string,
): NormalizedLocalStorageSpillOptions | undefined {
  if (!spill) return undefined;
  const storage = resolveLocalStorage(spill.storage);
  if (!storage) return undefined;
  const namespace = spill.namespace ?? `${dbName}:${storeName}`;
  return {
    drainOnCreate: spill.drainOnCreate ?? true,
    key: `loggerjs:spill:v1:${namespace}`,
    maxBytes: normalizePositiveInteger(spill.maxBytes, DEFAULT_SPILL_MAX_BYTES),
    maxEntries: normalizePositiveInteger(spill.maxEntries, DEFAULT_SPILL_MAX_ENTRIES),
    maxOriginBytes: normalizePositiveInteger(spill.maxOriginBytes, DEFAULT_SPILL_MAX_ORIGIN_BYTES),
    minLevelValue: spill.minLevel === undefined ? undefined : toLevelValue(spill.minLevel),
    onDrop: spill.onDrop,
    spillOnPageHide: spill.spillOnPageHide ?? true,
    storage,
  };
}

function storageByteLength(key: string, value: string): number {
  return 2 * (key.length + value.length);
}

function estimateLocalStorageBytes(storage: Storage): number | undefined {
  try {
    let total = 0;
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key === null) continue;
      total += storageByteLength(key, storage.getItem(key) ?? "");
    }
    return total;
  } catch {
    return undefined;
  }
}

function isQuotaExceededError(error: unknown): boolean {
  return (
    typeof DOMException !== "undefined" &&
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED")
  );
}

function isSpillLogEvent(value: unknown): value is LogEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<LogEvent>;
  return (
    typeof event.id === "string" &&
    typeof event.time === "number" &&
    typeof event.seq === "number" &&
    typeof event.level === "number" &&
    typeof event.levelName === "string" &&
    typeof event.logger === "string" &&
    typeof event.message === "string"
  );
}

function parseSpillPayload(raw: string): LogEvent[] | undefined {
  const parsed = JSON.parse(raw) as Partial<LocalStorageSpillPayload>;
  if (parsed.schema !== SPILL_SCHEMA || !Array.isArray(parsed.entries)) return undefined;
  return parsed.entries.filter(isSpillLogEvent);
}

function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function incrementRecord(record: Record<string, number>, key: string, amount = 1): void {
  record[key] = (record[key] ?? 0) + amount;
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

function ensureIndex(store: IDBObjectStore, name: string, keyPath: string | readonly string[]) {
  if (!indexExists(store, name)) store.createIndex(name, keyPath);
}

function getStoreIndex(store: IDBObjectStore, name: string): IDBIndex | undefined {
  const maybeStore = store as IDBObjectStore & {
    index?: (indexName: string) => IDBIndex;
  };
  if (typeof maybeStore.index !== "function" || !indexExists(store, name)) return undefined;
  return maybeStore.index(name);
}

function getStorageBucketManager(): StorageBucketManagerLike | undefined {
  return (globalThis.navigator as unknown as { storageBuckets?: StorageBucketManagerLike })
    ?.storageBuckets;
}

function storageBucketOpenOptions(options: IndexedDbTransportOptions):
  | {
      durability?: IndexedDbStorageBucketDurability;
      persisted?: boolean;
    }
  | undefined {
  if (
    options.storageBucketDurability === undefined &&
    options.storageBucketPersisted === undefined
  ) {
    return undefined;
  }
  return {
    durability: options.storageBucketDurability,
    persisted: options.storageBucketPersisted,
  };
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
  if (options.sessionId !== undefined && entry.sessionId !== options.sessionId) return false;
  if (options.minLevel !== undefined && entry.level < toLevelValue(options.minLevel)) return false;
  if (options.logger !== undefined && entry.logger !== options.logger) return false;
  if (options.type !== undefined && entry.type !== options.type) return false;
  return true;
}

function orderRangeForQuery(options: IndexedDbTransportQueryOptions): IDBKeyRange | undefined {
  if (typeof IDBKeyRange === "undefined") return undefined;
  if (options.sessionId !== undefined) {
    const lower = [
      options.sessionId,
      options.from ?? Number.MIN_SAFE_INTEGER,
      Number.MIN_SAFE_INTEGER,
      "",
    ];
    const upper = [
      options.sessionId,
      options.to ?? Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER,
      "\uffff",
    ];
    return IDBKeyRange.bound(lower, upper);
  }
  const lower =
    options.from === undefined ? undefined : [options.from, Number.MIN_SAFE_INTEGER, ""];
  const upper =
    options.to === undefined ? undefined : [options.to, Number.MAX_SAFE_INTEGER, "\uffff"];
  if (lower && upper) return IDBKeyRange.bound(lower, upper);
  if (lower) return IDBKeyRange.lowerBound(lower);
  if (upper) return IDBKeyRange.upperBound(upper);
  return undefined;
}

function iterateCursor(
  request: IDBRequest<IDBCursorWithValue | null>,
  visit: (cursor: IDBCursorWithValue) => boolean | void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    request.addEventListener(
      "success",
      () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        try {
          const shouldContinue = visit(cursor);
          if (shouldContinue === false) {
            resolve();
            return;
          }
          cursor.continue();
        } catch (error) {
          reject(error);
        }
      },
      false,
    );
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("IndexedDB cursor failed")),
      { once: true },
    );
  });
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
  const flushOnPageHide = options.flushOnPageHide ?? true;
  const durability = options.durability ?? "default";
  const rootIndexedDB = options.indexedDB ?? globalThis.indexedDB;
  const sessionOptions = normalizeSessionOptions(options.session);
  const spillOptions = normalizeLocalStorageSpillOptions(
    options.localStorageSpill,
    dbName,
    storeName,
  );
  const transactionOptions =
    durability === "default"
      ? undefined
      : ({
          durability,
        } satisfies IDBTransactionOptions);

  const buffer: LogEvent[] = [];
  let dbPromise: Promise<IDBDatabase> | undefined;
  let indexedDBFactoryPromise: Promise<IDBFactory | undefined> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let flushPromise: Promise<void> | undefined;
  let pendingFlushBatch: LogEvent[] | undefined;
  let spillDrainPromise: Promise<void> | undefined;
  let localStorageSpillClearCandidate: LocalStorageSpillClearCandidate | undefined;
  let lastContext: TransportContext | undefined;
  let closed = false;
  const statsState: IndexedDbTransportStats = {
    bufferDepth: 0,
    maxBufferDepth: 0,
    pendingFlush: false,
    enqueued: 0,
    persisted: 0,
    dropped: 0,
    droppedByReason: {},
    persistedDropped: 0,
    persistedDroppedByReason: {},
    flushes: 0,
    flushErrors: 0,
    lastFlushBatchSize: 0,
    lastFlushDurationMs: 0,
    prunes: 0,
    pruneFallbacks: 0,
    lastPruneDurationMs: 0,
    queries: 0,
    queryFallbacks: 0,
    lastQueryDurationMs: 0,
    databaseOpenCount: 0,
    storageBucketFallbacks: 0,
    transactionOptionFallbacks: 0,
    errors: 0,
    errorsByOperation: {},
    localStorageSpillWrites: 0,
    localStorageSpillEntries: 0,
    localStorageSpillDrains: 0,
    localStorageSpillDrainedEntries: 0,
    localStorageSpillDropped: 0,
    localStorageSpillDroppedByReason: {},
    localStorageSpillErrors: 0,
    localStorageSpillErrorsByOperation: {},
  };

  const snapshotStats = (): IndexedDbTransportStats => ({
    ...statsState,
    bufferDepth: buffer.length,
    droppedByReason: { ...statsState.droppedByReason },
    errorsByOperation: { ...statsState.errorsByOperation },
    localStorageSpillDroppedByReason: { ...statsState.localStorageSpillDroppedByReason },
    localStorageSpillErrorsByOperation: { ...statsState.localStorageSpillErrorsByOperation },
    pendingFlush: flushPromise !== undefined,
    persistedDroppedByReason: { ...statsState.persistedDroppedByReason },
  });

  const reportInternalError = (error: unknown, operation: string) => {
    statsState.errors += 1;
    incrementRecord(statsState.errorsByOperation, operation);
    lastContext?.reportInternalError(error, {
      operation,
      phase: "transport",
      transport: options.name ?? "indexeddb",
    });
  };

  const dropEvent = (event: LogEvent, reason: string) => {
    statsState.dropped += 1;
    incrementRecord(statsState.droppedByReason, reason);
    incrementLoggerMetaCounter("transport.indexeddb.dropped");
    incrementLoggerMetaCounter(`transport.indexeddb.dropped.${reason}`);
    options.onDrop?.(event, reason);
  };

  const dropPersistedEntry = (entry: IndexedDbLogEntry, reason: string) => {
    statsState.persistedDropped += 1;
    incrementRecord(statsState.persistedDroppedByReason, reason);
    incrementLoggerMetaCounter("transport.indexeddb.persisted.dropped");
    incrementLoggerMetaCounter(`transport.indexeddb.persisted.dropped.${reason}`);
    options.onPersistedDrop?.(entry, reason);
  };

  const reportSpillError = (error: unknown, operation: string) => {
    statsState.localStorageSpillErrors += 1;
    incrementRecord(statsState.localStorageSpillErrorsByOperation, operation);
    reportInternalError(error, `localstorage-spill-${operation}`);
  };

  const dropSpillEvent = (event: LogEvent, reason: string) => {
    statsState.localStorageSpillDropped += 1;
    incrementRecord(statsState.localStorageSpillDroppedByReason, reason);
    incrementLoggerMetaCounter("transport.indexeddb.localstorage_spill.dropped");
    incrementLoggerMetaCounter(`transport.indexeddb.localstorage_spill.dropped.${reason}`);
    spillOptions?.onDrop?.(event, reason);
  };

  const resolveIndexedDBFactory = async () => {
    if (options.indexedDB || !options.storageBucketName) return rootIndexedDB;
    indexedDBFactoryPromise ??= (async () => {
      const manager = getStorageBucketManager();
      if (!manager) {
        statsState.storageBucketFallbacks += 1;
        return rootIndexedDB;
      }
      try {
        const bucket = await manager.open(
          options.storageBucketName as string,
          storageBucketOpenOptions(options),
        );
        if (bucket.indexedDB) return bucket.indexedDB;
        statsState.storageBucketFallbacks += 1;
        return rootIndexedDB;
      } catch (error) {
        statsState.storageBucketFallbacks += 1;
        reportInternalError(error, "storage-bucket-open");
        return rootIndexedDB;
      }
    })();
    return indexedDBFactoryPromise;
  };

  const openDb = () => {
    dbPromise ??= resolveIndexedDBFactory().then((idb) => {
      if (!idb) throw new Error("IndexedDB is not available for indexedDbTransport");
      return new Promise<IDBDatabase>((resolve, reject) => {
        const request = idb.open(dbName, DB_VERSION);
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
          ensureIndex(store, ORDER_INDEX_NAME, ["createdAt", "seq", "id"]);
          ensureIndex(store, SESSION_INDEX_NAME, "sessionId");
          ensureIndex(store, SESSION_ORDER_INDEX_NAME, ["sessionId", "createdAt", "seq", "id"]);
        });
        request.addEventListener(
          "success",
          () => {
            statsState.databaseOpenCount += 1;
            resolve(request.result);
          },
          { once: true },
        );
        request.addEventListener(
          "error",
          () => reject(request.error ?? new Error("IndexedDB open failed")),
          { once: true },
        );
      });
    });
    return dbPromise;
  };

  const createTransaction = (db: IDBDatabase, mode: IDBTransactionMode) => {
    if (mode !== "readwrite" || !transactionOptions) return db.transaction(storeName, mode);
    try {
      return db.transaction(storeName, mode, transactionOptions);
    } catch {
      statsState.transactionOptionFallbacks += 1;
      return db.transaction(storeName, mode);
    }
  };

  const withStore = async <T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore, transaction: IDBTransaction) => T | Promise<T>,
  ): Promise<T> => {
    const db = await openDb();
    const tx = createTransaction(db, mode);
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

  const countEntries = async (): Promise<number | undefined> =>
    withStore("readonly", (store) => {
      const maybeStore = store as IDBObjectStore & {
        count?: () => IDBRequest<number>;
      };
      if (typeof maybeStore.count !== "function") return undefined;
      return requestToPromise(maybeStore.count.call(store));
    });

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

  const deleteByCursor = async (
    reason: string,
    openCursor: (store: IDBObjectStore) => IDBRequest<IDBCursorWithValue | null> | undefined,
    shouldDelete: (entry: IndexedDbLogEntry, deleted: number) => boolean,
  ): Promise<number | undefined> =>
    withStore("readwrite", async (store) => {
      const request = openCursor(store);
      if (!request) return undefined;
      let deleted = 0;
      await iterateCursor(request, (cursor) => {
        const entry = cursor.value as IndexedDbLogEntry;
        if (!shouldDelete(entry, deleted)) return false;
        cursor.delete();
        deleted += 1;
        dropPersistedEntry(entry, reason);
        return true;
      });
      return deleted;
    });

  const deleteExpiredByCursor = async (cutoff: number): Promise<number | undefined> => {
    if (typeof IDBKeyRange === "undefined") return undefined;
    const range = IDBKeyRange.upperBound(cutoff, true);
    return deleteByCursor(
      "ttl",
      (store) => getStoreIndex(store, "createdAt")?.openCursor(range),
      () => true,
    );
  };

  const deleteOldestByCursor = async (
    reason: string,
    count: number,
  ): Promise<number | undefined> => {
    if (count <= 0) return 0;
    return deleteByCursor(
      reason,
      (store) => getStoreIndex(store, ORDER_INDEX_NAME)?.openCursor(),
      (_entry, deleted) => deleted < count,
    );
  };

  const deleteOldestBytesByCursor = async (bytesToFree: number): Promise<number | undefined> => {
    if (bytesToFree <= 0) return 0;
    let freed = 0;
    return deleteByCursor(
      "max-bytes",
      (store) => getStoreIndex(store, ORDER_INDEX_NAME)?.openCursor(),
      (entry) => {
        if (freed >= bytesToFree) return false;
        freed += entry.byteLength;
        return true;
      },
    );
  };

  const sumBytesByCursor = async (): Promise<number | undefined> =>
    withStore("readonly", async (store) => {
      const index = getStoreIndex(store, ORDER_INDEX_NAME);
      if (!index) return undefined;
      let total = 0;
      await iterateCursor(index.openCursor(), (cursor) => {
        total += (cursor.value as IndexedDbLogEntry).byteLength;
      });
      return total;
    });

  const queryEntriesByCursor = async (
    queryOptions: IndexedDbTransportQueryOptions,
  ): Promise<IndexedDbLogEntry[] | undefined> =>
    withStore("readonly", async (store) => {
      const index = getStoreIndex(
        store,
        queryOptions.sessionId === undefined ? ORDER_INDEX_NAME : SESSION_ORDER_INDEX_NAME,
      );
      if (!index) return undefined;
      const entries: IndexedDbLogEntry[] = [];
      const limit = queryOptions.limit;
      if (limit !== undefined && limit <= 0) return entries;
      await iterateCursor(
        index.openCursor(
          orderRangeForQuery(queryOptions),
          queryOptions.order === "desc" ? "prev" : "next",
        ),
        (cursor) => {
          const entry = cursor.value as IndexedDbLogEntry;
          if (!shouldKeepEntry(entry, queryOptions)) return true;
          entries.push(entry);
          return limit === undefined || entries.length < limit;
        },
      );
      return entries;
    });

  const listSessions = async (
    sessionQueryOptions: IndexedDbTransportSessionQueryOptions = {},
  ): Promise<IndexedDbLogSession[]> => {
    const sessions = new Map<string, IndexedDbLogSession>();
    for (const entry of await getEntries()) {
      if (!entry.sessionId) continue;
      const current = sessions.get(entry.sessionId);
      if (current) {
        current.firstSeen = Math.min(current.firstSeen, entry.createdAt);
        current.lastSeen = Math.max(current.lastSeen, entry.createdAt);
        current.count += 1;
        current.byteLength += entry.byteLength;
      } else {
        sessions.set(entry.sessionId, {
          byteLength: entry.byteLength,
          count: 1,
          firstSeen: entry.createdAt,
          lastSeen: entry.createdAt,
          sessionId: entry.sessionId,
        });
      }
    }

    // oxlint-disable-next-line no-array-sort -- Sort a copy for deterministic session lists.
    const ordered = [...sessions.values()].sort((left, right) => {
      if (left.lastSeen !== right.lastSeen) return left.lastSeen - right.lastSeen;
      return left.sessionId < right.sessionId ? -1 : left.sessionId > right.sessionId ? 1 : 0;
    });
    if (sessionQueryOptions.order !== "asc") ordered.reverse();
    return ordered.slice(0, sessionQueryOptions.limit);
  };

  const pruneWithEntries = async () => {
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

  const pruneWithCursors = async (): Promise<boolean> => {
    if (options.ttlMs !== undefined) {
      const deleted = await deleteExpiredByCursor(Date.now() - options.ttlMs);
      if (deleted === undefined) return false;
    }

    if (maxEntries >= 0) {
      const persistedCount = await countEntries();
      if (persistedCount === undefined) return false;
      if (persistedCount > maxEntries) {
        const deleted = await deleteOldestByCursor("max-entries", persistedCount - maxEntries);
        if (deleted === undefined) return false;
      }
    }

    if (maxBytes >= 0) {
      const totalBytes = await sumBytesByCursor();
      if (totalBytes === undefined) return false;
      if (totalBytes > maxBytes) {
        const deleted = await deleteOldestBytesByCursor(totalBytes - maxBytes);
        if (deleted === undefined) return false;
      }
    }

    return true;
  };

  const prune = async () => {
    const startedAt = nowMs();
    try {
      if (await pruneWithCursors()) return;
      statsState.pruneFallbacks += 1;
      await pruneWithEntries();
    } finally {
      statsState.prunes += 1;
      statsState.lastPruneDurationMs = nowMs() - startedAt;
    }
  };

  const sessionIdForEvent = (event: LogEvent): string | undefined => {
    if (!sessionOptions) return undefined;
    return (
      normalizeSessionId(sessionOptions.getId?.(event)) ??
      normalizeSessionId(event.context?.[sessionOptions.contextKey]) ??
      sessionOptions.id
    );
  };

  const eventWithSessionContext = (event: LogEvent, sessionId: string | undefined): LogEvent => {
    if (!sessionId || !sessionOptions?.contextKey) return event;
    if (event.context?.[sessionOptions.contextKey] === sessionId) return event;
    return {
      ...event,
      context: {
        ...event.context,
        [sessionOptions.contextKey]: sessionId,
      },
    };
  };

  const eventWithResolvedSession = (
    event: LogEvent,
  ): {
    event: LogEvent;
    sessionId?: string;
  } => {
    const sessionId = sessionIdForEvent(event);
    return {
      event: eventWithSessionContext(event, sessionId),
      sessionId,
    };
  };

  const eventToEntry = (event: LogEvent): IndexedDbLogEntry => {
    const resolved = eventWithResolvedSession(event);
    const payload = codec.encode(resolved.event);
    return {
      id: event.id,
      sessionId: resolved.sessionId,
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

  const clearLocalStorageSpill = (expectedValue?: string): boolean => {
    if (!spillOptions) return false;
    try {
      if (
        expectedValue !== undefined &&
        spillOptions.storage.getItem(spillOptions.key) !== expectedValue
      ) {
        return false;
      }
      spillOptions.storage.removeItem(spillOptions.key);
      if (expectedValue === undefined || localStorageSpillClearCandidate?.value === expectedValue) {
        localStorageSpillClearCandidate = undefined;
      }
      return true;
    } catch (error) {
      reportSpillError(error, "clear");
      return false;
    }
  };

  const rememberLocalStorageSpill = (value: string, events: readonly LogEvent[]) => {
    localStorageSpillClearCandidate = {
      pendingIds: new Set(events.map((event) => event.id)),
      value,
    };
  };

  const markLocalStorageSpillPersisted = (events: readonly LogEvent[]) => {
    const candidate = localStorageSpillClearCandidate;
    if (!candidate || events.length === 0) return;
    for (const event of events) candidate.pendingIds.delete(event.id);
    if (candidate.pendingIds.size === 0) clearLocalStorageSpill(candidate.value);
  };

  const writeBatch = async (events: readonly LogEvent[]) => {
    if (events.length === 0) return;
    const startedAt = nowMs();
    statsState.lastFlushBatchSize = events.length;
    const entries = events.map(eventToEntry);
    try {
      await withStore("readwrite", (store) => {
        for (const entry of entries) {
          store.put(entry);
        }
      });
      statsState.persisted += entries.length;
      incrementLoggerMetaCounter("transport.indexeddb.persisted", entries.length);
      markLocalStorageSpillPersisted(events);
      await prune();
      statsState.flushes += 1;
    } catch (error) {
      statsState.flushErrors += 1;
      throw error;
    } finally {
      statsState.lastFlushDurationMs = nowMs() - startedAt;
    }
  };

  const stringifySpillPayload = (events: readonly LogEvent[]): string =>
    safeJsonStringify(
      {
        createdAt: Date.now(),
        entries: events,
        schema: SPILL_SCHEMA,
      } satisfies LocalStorageSpillPayload,
      { maxArrayLength: spillOptions?.maxEntries ?? DEFAULT_SPILL_MAX_ENTRIES },
    );

  const spillStorageBudget = (currentValue: string | null): number => {
    if (!spillOptions) return 0;
    const ownBytes = currentValue ? storageByteLength(spillOptions.key, currentValue) : 0;
    const originBytes = estimateLocalStorageBytes(spillOptions.storage);
    if (originBytes === undefined) return spillOptions.maxBytes;
    return Math.max(
      0,
      Math.min(spillOptions.maxBytes, spillOptions.maxOriginBytes - originBytes + ownBytes),
    );
  };

  const pendingEventsForSpill = (): LogEvent[] => {
    const events = [...(pendingFlushBatch ?? []), ...buffer];
    const seen = new Set<string>();
    const deduped: LogEvent[] = [];
    for (const event of events) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      if (spillOptions?.minLevelValue !== undefined && event.level < spillOptions.minLevelValue) {
        continue;
      }
      deduped.push(eventWithResolvedSession(event).event);
    }
    return deduped;
  };

  const mergeCurrentSpillEvents = (
    currentValue: string | null,
    pendingEvents: readonly LogEvent[],
  ): LogEvent[] => {
    const merged = new Map<string, LogEvent>();
    if (currentValue) {
      try {
        for (const event of parseSpillPayload(currentValue) ?? []) merged.set(event.id, event);
      } catch (error) {
        reportSpillError(error, "merge");
      }
    }
    for (const event of pendingEvents) merged.set(event.id, event);
    return [...merged.values()];
  };

  const trimSpillEventsToBudget = (events: LogEvent[], budget: number): string | undefined => {
    if (!spillOptions) return undefined;
    while (events.length > spillOptions.maxEntries) {
      const dropped = events.shift();
      if (dropped) dropSpillEvent(dropped, "max-entries");
    }
    while (events.length > 0) {
      const value = stringifySpillPayload(events);
      if (storageByteLength(spillOptions.key, value) <= budget) return value;
      const dropped = events.shift();
      if (dropped) dropSpillEvent(dropped, "max-bytes");
    }
    return undefined;
  };

  const writeLocalStorageSpill = () => {
    if (!spillOptions) return;
    const pendingEvents = pendingEventsForSpill();
    if (pendingEvents.length === 0) return;

    try {
      const currentValue = spillOptions.storage.getItem(spillOptions.key);
      const events = mergeCurrentSpillEvents(currentValue, pendingEvents);
      const budget = spillStorageBudget(currentValue);
      const value = trimSpillEventsToBudget(events, budget);
      if (!value) return;
      try {
        spillOptions.storage.setItem(spillOptions.key, value);
      } catch (error) {
        if (!isQuotaExceededError(error)) throw error;
        while (events.length > 0) {
          const dropped = events.shift();
          if (dropped) dropSpillEvent(dropped, "quota");
          const retryValue = trimSpillEventsToBudget(events, budget);
          if (!retryValue) return;
          try {
            spillOptions.storage.setItem(spillOptions.key, retryValue);
            rememberLocalStorageSpill(retryValue, events);
            statsState.localStorageSpillWrites += 1;
            statsState.localStorageSpillEntries += events.length;
            return;
          } catch (retryError) {
            if (!isQuotaExceededError(retryError)) throw retryError;
          }
        }
        return;
      }
      rememberLocalStorageSpill(value, events);
      statsState.localStorageSpillWrites += 1;
      statsState.localStorageSpillEntries += events.length;
    } catch (error) {
      reportSpillError(error, "write");
    }
  };

  const drainLocalStorageSpill = async () => {
    if (!spillOptions) return;
    let raw: string | null;
    try {
      raw = spillOptions.storage.getItem(spillOptions.key);
    } catch (error) {
      reportSpillError(error, "read");
      return;
    }
    if (!raw) return;

    let events: LogEvent[] | undefined;
    try {
      events = parseSpillPayload(raw);
    } catch (error) {
      reportSpillError(error, "parse");
      clearLocalStorageSpill();
      return;
    }
    if (!events || events.length === 0) {
      clearLocalStorageSpill();
      return;
    }

    await writeBatch(events);
    clearLocalStorageSpill(raw);
    statsState.localStorageSpillDrains += 1;
    statsState.localStorageSpillDrainedEntries += events.length;
  };

  const ensureSpillDrained = async () => {
    const promise = spillDrainPromise;
    if (!promise) return;
    await promise;
  };

  if (spillOptions?.drainOnCreate) {
    spillDrainPromise = drainLocalStorageSpill()
      .catch((error: unknown) => reportSpillError(error, "drain"))
      .finally(() => {
        spillDrainPromise = undefined;
      });
  }

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };

  const flushPending = async () => {
    if (flushPromise) return flushPromise;
    clearTimer();
    const batch = buffer.splice(0, buffer.length);
    pendingFlushBatch = batch;
    flushPromise = (async () => {
      await ensureSpillDrained();
      await writeBatch(batch);
    })().finally(() => {
      if (pendingFlushBatch === batch) pendingFlushBatch = undefined;
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
    if (spillOptions?.spillOnPageHide) writeLocalStorageSpill();
    if (flushOnPageHide) {
      void flushPending().catch((error: unknown) => reportInternalError(error, "pagehide-flush"));
    }
  };

  const onVisibilityChange = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      if (spillOptions?.spillOnPageHide) writeLocalStorageSpill();
      if (flushOnPageHide) {
        void flushPending().catch((error: unknown) =>
          reportInternalError(error, "visibility-flush"),
        );
      }
    }
  };

  const addVisibilityChangeListener = (): (() => void) | undefined => {
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", onVisibilityChange);
      return () => document.removeEventListener("visibilitychange", onVisibilityChange);
    }
    if (typeof globalThis.addEventListener !== "function") return undefined;
    globalThis.addEventListener("visibilitychange", onVisibilityChange);
    return () => globalThis.removeEventListener?.("visibilitychange", onVisibilityChange);
  };

  let removeVisibilityChangeListener: (() => void) | undefined;
  if (flushOnPageHide || spillOptions?.spillOnPageHide) {
    globalThis.addEventListener?.("pagehide", onPageHide);
    removeVisibilityChangeListener = addVisibilityChangeListener();
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
      statsState.enqueued += 1;
      statsState.maxBufferDepth = Math.max(statsState.maxBufferDepth, buffer.length);
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
      return (await countEntries()) ?? (await getEntries()).length;
    },
    async clear() {
      buffer.length = 0;
      clearTimer();
      clearLocalStorageSpill();
      await withStore("readwrite", (store) => requestToPromise(store.clear()));
    },
    async remove(ids) {
      await flushPending();
      const items = typeof ids === "string" ? [ids] : ids;
      if (items.length === 0) return;
      await withStore("readwrite", async (store) => {
        for (const id of items) {
          // oxlint-disable-next-line no-await-in-loop -- Deletes must preserve fake IDB transaction ordering.
          await requestToPromise(store.delete(id));
        }
      });
    },
    async *query(queryOptions: IndexedDbTransportQueryOptions = {}) {
      await flushPending();
      const startedAt = nowMs();
      const cursorEntries = await queryEntriesByCursor(queryOptions);
      if (cursorEntries === undefined) statsState.queryFallbacks += 1;
      const entries =
        cursorEntries ??
        orderEntries(await getEntries(), queryOptions.order ?? "asc")
          .filter((entry) => shouldKeepEntry(entry, queryOptions))
          .slice(0, queryOptions.limit);
      statsState.queries += 1;
      statsState.lastQueryDurationMs = nowMs() - startedAt;
      for (const entry of entries) {
        const event = decodeEntry(entry, codec);
        if (event) yield event;
      }
    },
    async sessions(sessionQueryOptions: IndexedDbTransportSessionQueryOptions = {}) {
      await flushPending();
      return listSessions(sessionQueryOptions);
    },
    stats() {
      return snapshotStats();
    },
    close() {
      closed = true;
      clearTimer();
      globalThis.removeEventListener?.("pagehide", onPageHide);
      removeVisibilityChangeListener?.();
      removeVisibilityChangeListener = undefined;
      const flushed = flushPending();
      return flushed.finally(() => {
        const promise = dbPromise;
        dbPromise = undefined;
        return promise?.then((db) => db.close());
      });
    },
  };
}
