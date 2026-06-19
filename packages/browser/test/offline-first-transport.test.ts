import { describe, expect, it, vi } from "vitest";
import {
  getLoggerMetaStats,
  recordToEvent,
  resetLoggerMetaStats,
  type LogEvent,
  type Transport,
  type TransportContext,
} from "@loggerjs/core";
import {
  offlineFirstTransport,
  type IndexedDbTransportOptions,
  type OfflineFirstQueue,
} from "../src";

const context: TransportContext = {
  loggerName: "test",
  now: () => 1,
  toEvent: recordToEvent,
  reportInternalError: vi.fn<TransportContext["reportInternalError"]>(),
};

function event(id: string, seq = 1): LogEvent {
  return {
    id,
    time: seq,
    seq,
    level: 30,
    levelName: "info",
    logger: "web",
    message: id,
  };
}

function memoryQueue(): OfflineFirstQueue & { events: LogEvent[] } {
  const events: LogEvent[] = [];
  return {
    events,
    log(next) {
      events.push(next);
    },
    async *query(options = {}) {
      const limit = options.limit ?? events.length;
      for (const item of events.slice(0, limit)) yield item;
    },
    async remove(ids) {
      const set = new Set(typeof ids === "string" ? [ids] : ids);
      for (let index = events.length - 1; index >= 0; index -= 1) {
        if (set.has((events[index] as LogEvent).id)) events.splice(index, 1);
      }
    },
    async count() {
      return events.length;
    },
    async clear() {
      events.length = 0;
    },
  };
}

describe("offlineFirstTransport", () => {
  it("queues events when the remote transport fails and replays them later", async () => {
    resetLoggerMetaStats();
    const queue = memoryQueue();
    const sent: string[] = [];
    let fail = true;
    const remote: Transport = {
      name: "remote",
      log(next) {
        if (fail) throw new Error("offline");
        sent.push(next.id);
      },
      logBatch(batch) {
        if (fail) throw new Error("offline");
        sent.push(...batch.map((item) => item.id));
      },
    };
    const transport = offlineFirstTransport(remote, {
      queue,
      replayOnOnline: false,
      retry: { maxRetries: 0 },
    });

    await transport.log?.(event("first"), context);
    expect(queue.events.map((item) => item.id)).toEqual(["first"]);
    expect(sent).toEqual([]);

    fail = false;
    await transport.flush?.();

    expect(sent).toEqual(["first"]);
    expect(await transport.queuedCount()).toBe(0);
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.offline.queued": 1,
      "transport.offline.replayed": 1,
    });
  });

  it("queues immediately while the browser is offline", async () => {
    resetLoggerMetaStats();
    const queue = memoryQueue();
    const log = vi.fn<NonNullable<Transport["log"]>>();
    const transport = offlineFirstTransport(
      { name: "remote", log },
      {
        online: () => false,
        queue,
        replayOnOnline: false,
      },
    );

    await transport.log?.(event("offline"), context);

    expect(log).not.toHaveBeenCalled();
    expect(queue.events.map((item) => item.id)).toEqual(["offline"]);
  });

  it("replays persisted queue entries before any new log is written", async () => {
    resetLoggerMetaStats();
    const queue = memoryQueue();
    queue.events.push(event("persisted"));
    const sent: string[] = [];
    const transport = offlineFirstTransport(
      {
        name: "remote",
        logBatch(batch) {
          sent.push(...batch.map((item) => item.id));
        },
      },
      {
        queue,
        replayOnOnline: false,
        retry: { maxRetries: 0 },
      },
    );

    await transport.replay();

    expect(sent).toEqual(["persisted"]);
    expect(queue.events).toEqual([]);
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.offline.replayed": 1,
    });
  });

  it("removes only replayed ids and keeps entries queued after replay failure", async () => {
    resetLoggerMetaStats();
    const queue = memoryQueue();
    queue.events.push(event("first"), event("second", 2));
    const remote: Transport = {
      name: "remote",
      logBatch() {
        throw new Error("still offline");
      },
    };
    const transport = offlineFirstTransport(remote, {
      queue,
      replayBatchSize: 2,
      replayOnOnline: false,
      retry: { maxRetries: 0 },
    });
    await transport.log?.(event("third", 3), context);

    await expect(transport.flush?.()).rejects.toThrow("still offline");

    expect(queue.events.map((item) => item.id)).toEqual(["first", "second", "third"]);
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.offline.replay.failed": 1,
    });
  });

  it("keeps the default persistent replay queue from adding page sessions", async () => {
    vi.resetModules();
    const queue = memoryQueue();
    const queueOptions: IndexedDbTransportOptions[] = [];

    vi.doMock("../src/indexeddb-transport", () => ({
      indexedDbTransport(options: IndexedDbTransportOptions) {
        queueOptions.push(options);
        return queue;
      },
    }));

    try {
      const { offlineFirstTransport: createOfflineFirstTransport } =
        await import("../src/offline-first-transport");
      const transport = createOfflineFirstTransport(
        {
          name: "remote",
          log() {
            throw new Error("offline");
          },
        },
        {
          replayOnOnline: false,
          retry: { maxRetries: 0 },
        },
      );

      await transport.log?.(event("queued"), context);

      expect(queueOptions).toHaveLength(1);
      expect(queueOptions[0]).toMatchObject({ session: false });
      expect(queue.events[0]?.context).toBeUndefined();
    } finally {
      vi.doUnmock("../src/indexeddb-transport");
      vi.resetModules();
    }
  });

  it("normalizes undefined default queue sessions without blocking explicit overrides", async () => {
    vi.resetModules();
    const queue = memoryQueue();
    const queueOptions: IndexedDbTransportOptions[] = [];

    vi.doMock("../src/indexeddb-transport", () => ({
      indexedDbTransport(options: IndexedDbTransportOptions) {
        queueOptions.push(options);
        return queue;
      },
    }));

    try {
      const { offlineFirstTransport: createOfflineFirstTransport } =
        await import("../src/offline-first-transport");
      createOfflineFirstTransport(
        {
          name: "remote",
        },
        {
          queueOptions: { session: undefined },
          replayOnOnline: false,
        },
      );
      createOfflineFirstTransport(
        {
          name: "remote",
        },
        {
          queueOptions: { session: "custom-session" },
          replayOnOnline: false,
        },
      );

      expect(queueOptions.map((item) => item.session)).toEqual([false, "custom-session"]);
    } finally {
      vi.doUnmock("../src/indexeddb-transport");
      vi.resetModules();
    }
  });
});
