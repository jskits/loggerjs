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

class FakeObjectStore {
  readonly indexNames = {
    contains: (name: string) => this.indexes.has(name),
  };
  private readonly indexes = new Set<string>();

  constructor(
    private readonly entries: Map<string, IndexedDbLogEntry>,
    private readonly transaction?: FakeTransaction,
  ) {}

  createIndex(name: string) {
    this.indexes.add(name);
  }

  put(item: IndexedDbLogEntry) {
    const request = new FakeRequest<IDBValidKey>();
    this.entries.set(item.id, item);
    request.succeed(item.id);
    this.transaction?.completeSoon();
    return request as unknown as IDBRequest<IDBValidKey>;
  }

  getAll() {
    const request = new FakeRequest<IndexedDbLogEntry[]>();
    request.succeed([...this.entries.values()]);
    this.transaction?.completeSoon();
    return request as unknown as IDBRequest<IndexedDbLogEntry[]>;
  }

  delete(id: IDBValidKey) {
    const request = new FakeRequest<undefined>();
    this.entries.delete(String(id));
    request.succeed(undefined);
    this.transaction?.completeSoon();
    return request as unknown as IDBRequest<undefined>;
  }

  clear() {
    const request = new FakeRequest<undefined>();
    this.entries.clear();
    request.succeed(undefined);
    this.transaction?.completeSoon();
    return request as unknown as IDBRequest<undefined>;
  }
}

class FakeTransaction {
  error: Error | null = null;
  private completed = false;
  private readonly listeners = new Map<string, Array<() => void>>();

  constructor(private readonly entries: Map<string, IndexedDbLogEntry>) {}

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
    const store = new FakeObjectStore(this.entries, this);
    this.completeSoon();
    return store as unknown as IDBObjectStore;
  }
}

class FakeDatabase {
  readonly entries = new Map<string, IndexedDbLogEntry>();
  closed = false;
  private store: FakeObjectStore | undefined;
  private hasStore = false;
  objectStoreNames = {
    contains: () => this.hasStore,
  };

  createObjectStore() {
    this.hasStore = true;
    this.store = new FakeObjectStore(this.entries);
    return this.store as unknown as IDBObjectStore;
  }

  transaction() {
    if (!this.store) this.createObjectStore();
    return new FakeTransaction(this.entries) as unknown as IDBTransaction;
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
      (await collect(transport.query({ logger: "checkout", type: "ui.click" }))).map(
        (item) => item.id,
      ),
    ).toEqual(["first"]);
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
    await transport.clear();
    expect(await transport.count()).toBe(0);
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
