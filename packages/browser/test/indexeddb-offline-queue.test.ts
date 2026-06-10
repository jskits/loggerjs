import { afterEach, describe, expect, it } from "vitest";
import { getLoggerMetaStats, resetLoggerMetaStats } from "@loggerjs/core";
import { indexedDbBrowserHttpOfflineQueue, type BrowserHttpOfflineEntry } from "../src";

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

class FakeOpenRequest extends FakeRequest<FakeDatabase> {}

class FakeObjectStore {
  constructor(private readonly entries: Map<string, BrowserHttpOfflineEntry>) {}

  put(item: BrowserHttpOfflineEntry) {
    const request = new FakeRequest<IDBValidKey>();
    this.entries.set(item.id, item);
    request.succeed(item.id);
    return request as unknown as IDBRequest<IDBValidKey>;
  }

  getAll() {
    const request = new FakeRequest<BrowserHttpOfflineEntry[]>();
    request.succeed([...this.entries.values()]);
    return request as unknown as IDBRequest<BrowserHttpOfflineEntry[]>;
  }

  delete(id: IDBValidKey) {
    const request = new FakeRequest<undefined>();
    this.entries.delete(String(id));
    request.succeed(undefined);
    return request as unknown as IDBRequest<undefined>;
  }

  clear() {
    const request = new FakeRequest<undefined>();
    this.entries.clear();
    request.succeed(undefined);
    return request as unknown as IDBRequest<undefined>;
  }
}

class FakeDatabase {
  readonly entries = new Map<string, BrowserHttpOfflineEntry>();
  closed = false;
  objectStoreNames = {
    contains: () => true,
  };

  createObjectStore() {
    return new FakeObjectStore(this.entries) as unknown as IDBObjectStore;
  }

  transaction() {
    const store = new FakeObjectStore(this.entries) as unknown as IDBObjectStore;
    return {
      objectStore: () => store,
    } as unknown as IDBTransaction;
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
    queueMicrotask(() => {
      request.dispatch("upgradeneeded");
      request.dispatch("success");
    });
    return request as unknown as IDBOpenDBRequest;
  }
}

function entry(id: string, createdAt: number): BrowserHttpOfflineEntry {
  return {
    id,
    url: "/logs",
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: id,
    keepalive: true,
    createdAt,
  };
}

describe("indexedDbBrowserHttpOfflineQueue", () => {
  afterEach(() => {
    resetLoggerMetaStats();
  });

  it("replays entries in stable createdAt order and removes sent entries", async () => {
    const idb = new FakeIndexedDB();
    const queue = indexedDbBrowserHttpOfflineQueue({ indexedDB: idb as unknown as IDBFactory });

    await queue.enqueue(entry("second", 2));
    await queue.enqueue(entry("first", 1));
    const sent: string[] = [];
    await queue.replay(async (item) => {
      sent.push(item.id);
    });

    expect(sent).toEqual(["first", "second"]);
    expect(await queue.size()).toBe(0);
  });

  it("keeps unsent entries when replay fails", async () => {
    const idb = new FakeIndexedDB();
    const queue = indexedDbBrowserHttpOfflineQueue({ indexedDB: idb as unknown as IDBFactory });

    await queue.enqueue(entry("first", 1));
    await queue.enqueue(entry("second", 2));

    await expect(
      queue.replay(async (item) => {
        if (item.id === "first") throw new Error("offline");
      }),
    ).rejects.toThrow("offline");

    expect(await queue.size()).toBe(2);
  });

  it("drops oldest entries when the persistent queue is full", async () => {
    const idb = new FakeIndexedDB();
    const dropped: string[] = [];
    const queue = indexedDbBrowserHttpOfflineQueue({
      indexedDB: idb as unknown as IDBFactory,
      maxEntries: 2,
      onDrop: (item, reason) => dropped.push(`${item.id}:${reason}`),
    });

    await queue.enqueue(entry("first", 1));
    await queue.enqueue(entry("second", 2));
    await queue.enqueue(entry("third", 3));

    const sent: string[] = [];
    await queue.replay(async (item) => {
      sent.push(item.id);
    });

    expect(sent).toEqual(["second", "third"]);
    expect(dropped).toEqual(["first:queue-full"]);
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.offline.dropped": 1,
      "transport.offline.dropped.queue-full": 1,
    });
  });

  it("supports drop-newest and close", async () => {
    const idb = new FakeIndexedDB();
    const queue = indexedDbBrowserHttpOfflineQueue({
      indexedDB: idb as unknown as IDBFactory,
      maxEntries: 1,
      dropPolicy: "drop-newest",
    });

    await queue.enqueue(entry("first", 1));
    await queue.enqueue(entry("second", 2));
    queue.close();
    await Promise.resolve();

    expect(await queue.size()).toBe(1);
    expect(idb.db.closed).toBe(true);
  });
});
