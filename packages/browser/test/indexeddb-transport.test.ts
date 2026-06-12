import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getLoggerMetaStats,
  recordToEvent,
  resetLoggerMetaStats,
  type LogEvent,
  type TransportContext,
} from "@loggerjs/core";
import { indexedDbTransport, type IndexedDbLogEntry } from "../src";

class FakeRequest<T> {
  result!: T;
  error: Error | null = null;
  private listeners = new Map<string, Array<() => void>>();

  addEventListener(type: string, listener: () => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }

  succeed(value: T) {
    this.result = value;
    queueMicrotask(() => this.dispatch("success"));
  }
}

class FakeOpenRequest extends FakeRequest<FakeDatabase> {
  transaction?: FakeTransaction;
}

type FakeKeyPath = string | readonly string[];

interface FakeState {
  entries: Map<string, IndexedDbLogEntry>;
  getAllCalls: number;
  indexes: Map<string, FakeKeyPath>;
}

function valueForKeyPath(entry: IndexedDbLogEntry, keyPath: FakeKeyPath): IDBValidKey {
  if (typeof keyPath === "string") {
    return entry[keyPath as keyof IndexedDbLogEntry] as IDBValidKey;
  }
  return keyPath.map((key) => entry[key as keyof IndexedDbLogEntry]) as IDBValidKey;
}

function compareKey(left: IDBValidKey, right: IDBValidKey): number {
  if (Array.isArray(left) && Array.isArray(right)) {
    const length = Math.min(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      const compared = compareKey(left[index] as IDBValidKey, right[index] as IDBValidKey);
      if (compared !== 0) return compared;
    }
    return left.length - right.length;
  }
  if (typeof left === "number" && typeof right === "number") return left - right;
  const leftString = String(left);
  const rightString = String(right);
  return leftString < rightString ? -1 : leftString > rightString ? 1 : 0;
}

class FakeCursor {
  constructor(
    private readonly state: FakeState,
    private readonly items: IndexedDbLogEntry[],
    private index: number,
    private readonly request: FakeRequest<IDBCursorWithValue | null>,
    private readonly transaction?: FakeTransaction,
  ) {}

  get value() {
    return this.items[this.index] as IndexedDbLogEntry;
  }

  continue() {
    this.index += 1;
    const next =
      this.index >= this.items.length
        ? null
        : new FakeCursor(this.state, this.items, this.index, this.request, this.transaction);
    this.request.succeed(next as unknown as IDBCursorWithValue | null);
    this.transaction?.completeSoon();
  }

  delete() {
    const request = new FakeRequest<undefined>();
    this.state.entries.delete(this.value.id);
    request.succeed(undefined);
    this.transaction?.completeSoon();
    return request as unknown as IDBRequest<undefined>;
  }
}

class FakeIndex {
  constructor(
    private readonly state: FakeState,
    private readonly keyPath: FakeKeyPath,
    private readonly transaction?: FakeTransaction,
  ) {}

  openCursor(_query?: IDBValidKey | IDBKeyRange | null, direction: IDBCursorDirection = "next") {
    const items = [...this.state.entries.values()];
    items.sort((left, right) =>
      compareKey(valueForKeyPath(left, this.keyPath), valueForKeyPath(right, this.keyPath)),
    );
    if (direction === "prev" || direction === "prevunique") items.reverse();
    return createCursorRequest(this.state, items, this.transaction);
  }
}

function createCursorRequest(
  state: FakeState,
  items: IndexedDbLogEntry[],
  transaction?: FakeTransaction,
) {
  const request = new FakeRequest<IDBCursorWithValue | null>();
  const cursor = items.length === 0 ? null : new FakeCursor(state, items, 0, request, transaction);
  request.succeed(cursor as unknown as IDBCursorWithValue | null);
  transaction?.completeSoon();
  return request as unknown as IDBRequest<IDBCursorWithValue | null>;
}

class FakeObjectStore {
  readonly indexNames = {
    contains: (name: string) => this.state.indexes.has(name),
  };

  constructor(
    private readonly state: FakeState,
    private readonly transaction?: FakeTransaction,
  ) {}

  createIndex(name: string, keyPath: FakeKeyPath) {
    this.state.indexes.set(name, keyPath);
  }

  index(name: string) {
    const keyPath = this.state.indexes.get(name);
    if (!keyPath) throw new Error(`Missing index ${name}`);
    return new FakeIndex(this.state, keyPath, this.transaction) as unknown as IDBIndex;
  }

  put(item: IndexedDbLogEntry) {
    const request = new FakeRequest<IDBValidKey>();
    this.state.entries.set(item.id, item);
    request.succeed(item.id);
    this.transaction?.completeSoon();
    return request as unknown as IDBRequest<IDBValidKey>;
  }

  getAll() {
    const request = new FakeRequest<IndexedDbLogEntry[]>();
    this.state.getAllCalls += 1;
    request.succeed([...this.state.entries.values()]);
    this.transaction?.completeSoon();
    return request as unknown as IDBRequest<IndexedDbLogEntry[]>;
  }

  count() {
    const request = new FakeRequest<number>();
    request.succeed(this.state.entries.size);
    this.transaction?.completeSoon();
    return request as unknown as IDBRequest<number>;
  }

  openCursor(_query?: IDBValidKey | IDBKeyRange | null, direction: IDBCursorDirection = "next") {
    const items = [...this.state.entries.values()];
    items.sort((left, right) => compareKey(left.id, right.id));
    if (direction === "prev" || direction === "prevunique") items.reverse();
    return createCursorRequest(this.state, items, this.transaction);
  }

  delete(id: IDBValidKey) {
    const request = new FakeRequest<undefined>();
    this.state.entries.delete(String(id));
    request.succeed(undefined);
    this.transaction?.completeSoon();
    return request as unknown as IDBRequest<undefined>;
  }

  clear() {
    const request = new FakeRequest<undefined>();
    this.state.entries.clear();
    request.succeed(undefined);
    this.transaction?.completeSoon();
    return request as unknown as IDBRequest<undefined>;
  }
}

class FakeTransaction {
  error: Error | null = null;
  private completed = false;
  private readonly listeners = new Map<string, Array<() => void>>();

  constructor(private readonly state: FakeState) {}

  addEventListener(type: string, listener: () => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  abort() {
    if (this.completed) return;
    this.completed = true;
    this.dispatch("abort");
  }

  completeSoon() {
    if (this.completed) return;
    queueMicrotask(() => {
      if (this.completed) return;
      this.completed = true;
      this.dispatch("complete");
    });
  }

  private dispatch(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }

  objectStore() {
    const store = new FakeObjectStore(this.state, this);
    this.completeSoon();
    return store as unknown as IDBObjectStore;
  }
}

class FakeDatabase {
  readonly state: FakeState = {
    entries: new Map<string, IndexedDbLogEntry>(),
    getAllCalls: 0,
    indexes: new Map<string, FakeKeyPath>(),
  };
  readonly transactionOptions: IDBTransactionOptions[] = [];
  closed = false;
  private store: FakeObjectStore | undefined;
  private hasStore = false;
  objectStoreNames = {
    contains: () => this.hasStore,
  };

  get entries() {
    return this.state.entries;
  }

  get getAllCalls() {
    return this.state.getAllCalls;
  }

  createObjectStore() {
    this.hasStore = true;
    this.store = new FakeObjectStore(this.state);
    return this.store as unknown as IDBObjectStore;
  }

  transaction(
    _storeName?: string | string[],
    _mode?: IDBTransactionMode,
    options?: IDBTransactionOptions,
  ) {
    if (!this.store) this.createObjectStore();
    if (options) this.transactionOptions.push(options);
    return new FakeTransaction(this.state) as unknown as IDBTransaction;
  }

  close() {
    this.closed = true;
  }
}

class FakeIndexedDB {
  readonly db = new FakeDatabase();

  open() {
    const request = new FakeOpenRequest();
    request.result = this.db;
    request.transaction = this.db.transaction() as unknown as FakeTransaction;
    queueMicrotask(() => {
      request.dispatch("upgradeneeded");
      request.dispatch("success");
    });
    return request as unknown as IDBOpenDBRequest;
  }
}

const context: TransportContext = {
  loggerName: "test",
  now: () => 1,
  toEvent: recordToEvent,
  reportInternalError: vi.fn<TransportContext["reportInternalError"]>(),
};

function event(id: string, time: number, patch: Partial<LogEvent> = {}): LogEvent {
  return {
    id,
    time,
    seq: time,
    level: 30,
    levelName: "info",
    logger: "web",
    message: `message ${id}`,
    ...patch,
  };
}

async function collect(source: AsyncIterable<LogEvent>) {
  const events: LogEvent[] = [];
  for await (const item of source) events.push(item);
  return events;
}

describe("indexedDbTransport", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetLoggerMetaStats();
  });

  it("persists buffered logs with micro-batch flush and queries them in order", async () => {
    const idb = new FakeIndexedDB();
    const transport = indexedDbTransport({
      batchSize: 2,
      flushIntervalMs: 10_000,
      indexedDB: idb as unknown as IDBFactory,
    });

    transport.log?.(event("second", 2), context);
    transport.log?.(event("first", 1, { logger: "checkout", type: "ui.click" }), context);
    await transport.flush?.();

    expect(await transport.count()).toBe(2);
    expect((await collect(transport.query())).map((item) => item.id)).toEqual(["first", "second"]);
    expect(
      (await collect(transport.query({ limit: 1, order: "desc" }))).map((item) => item.id),
    ).toEqual(["second"]);
    expect(
      (await collect(transport.query({ logger: "checkout", type: "ui.click" }))).map(
        (item) => item.id,
      ),
    ).toEqual(["first"]);
    expect(idb.db.getAllCalls).toBe(0);
    expect(transport.stats()).toMatchObject({
      bufferDepth: 0,
      enqueued: 2,
      flushes: 1,
      lastFlushBatchSize: 2,
      maxBufferDepth: 2,
      persisted: 2,
      prunes: 1,
      queries: 3,
      queryFallbacks: 0,
    });
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.indexeddb.persisted": 2,
    });
  });

  it("drops old persisted entries by maxEntries and ttl", async () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(10);
    const idb = new FakeIndexedDB();
    const transport = indexedDbTransport({
      indexedDB: idb as unknown as IDBFactory,
      maxEntries: 2,
      ttlMs: 5,
    });

    transport.log?.(event("expired", 1), context);
    transport.log?.(event("first", 6), context);
    transport.log?.(event("second", 7), context);
    transport.log?.(event("third", 8), context);
    await transport.flush?.();

    expect((await collect(transport.query())).map((item) => item.id)).toEqual(["second", "third"]);
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.indexeddb.persisted.dropped.max-entries": 1,
      "transport.indexeddb.persisted.dropped.ttl": 1,
    });
  });

  it("supports drop-newest buffer overflow and clear", async () => {
    const idb = new FakeIndexedDB();
    const dropped: string[] = [];
    const transport = indexedDbTransport({
      dropPolicy: "drop-newest",
      indexedDB: idb as unknown as IDBFactory,
      maxBufferSize: 1,
      onDrop: (item, reason) => dropped.push(`${item.id}:${reason}`),
    });

    transport.log?.(event("kept", 1), context);
    transport.log?.(event("dropped", 2), context);
    await transport.flush?.();

    expect((await collect(transport.query())).map((item) => item.id)).toEqual(["kept"]);
    expect(dropped).toEqual(["dropped:buffer-full"]);
    expect(transport.stats()).toMatchObject({
      dropped: 1,
      droppedByReason: { "buffer-full": 1 },
      enqueued: 1,
    });
    await transport.clear();
    expect(await transport.count()).toBe(0);
  });

  it("removes selected persisted logs by id", async () => {
    const idb = new FakeIndexedDB();
    const transport = indexedDbTransport({
      indexedDB: idb as unknown as IDBFactory,
    });

    transport.log?.(event("first", 1), context);
    transport.log?.(event("second", 2), context);
    transport.log?.(event("third", 3), context);
    await transport.flush?.();
    await transport.remove(["first", "third"]);

    expect((await collect(transport.query())).map((item) => item.id)).toEqual(["second"]);
  });

  it("passes durability to readwrite transactions when configured", async () => {
    const idb = new FakeIndexedDB();
    const transport = indexedDbTransport({
      durability: "relaxed",
      indexedDB: idb as unknown as IDBFactory,
    });

    transport.log?.(event("one", 1), context);
    await transport.flush?.();

    expect(idb.db.transactionOptions.some((item) => item.durability === "relaxed")).toBe(true);
  });

  it("uses Storage Buckets IndexedDB when available", async () => {
    const bucketIdb = new FakeIndexedDB();
    const rootIdb = new FakeIndexedDB();
    const open = vi.fn<() => Promise<{ indexedDB: IDBFactory }>>(async () => ({
      indexedDB: bucketIdb as unknown as IDBFactory,
    }));
    vi.stubGlobal("indexedDB", rootIdb as unknown as IDBFactory);
    vi.stubGlobal("navigator", {
      storageBuckets: { open },
    });
    const transport = indexedDbTransport({
      storageBucketDurability: "relaxed",
      storageBucketName: "loggerjs-logs",
      storageBucketPersisted: true,
    });

    transport.log?.(event("one", 1), context);
    await transport.flush?.();

    expect(open).toHaveBeenCalledWith("loggerjs-logs", {
      durability: "relaxed",
      persisted: true,
    });
    expect(bucketIdb.db.entries.has("one")).toBe(true);
    expect(rootIdb.db.entries.size).toBe(0);
  });

  it("closes the database after flushing pending logs", async () => {
    const idb = new FakeIndexedDB();
    const transport = indexedDbTransport({
      indexedDB: idb as unknown as IDBFactory,
    });

    transport.log?.(event("one", 1), context);
    await transport.close?.();

    expect(idb.db.entries.size).toBe(1);
    expect(idb.db.closed).toBe(true);
  });
});
