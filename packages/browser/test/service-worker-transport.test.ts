import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getLoggerMetaStats,
  recordToEvent,
  resetLoggerMetaStats,
  type LogEvent,
  type TransportContext,
} from "@loggerjs/core";
import {
  browserServiceWorkerTransport,
  type BrowserServiceWorkerContainerLike,
  type BrowserServiceWorkerLike,
} from "../src";

const event: LogEvent = {
  id: "evt-1",
  time: 1,
  seq: 1,
  level: 30,
  levelName: "info",
  logger: "browser",
  message: "ready",
};

function createContext(errors: unknown[] = []): TransportContext {
  return {
    loggerName: "browser",
    now: () => 1,
    toEvent: recordToEvent,
    reportInternalError(error) {
      errors.push(error);
    },
  };
}

function createWorker(): BrowserServiceWorkerLike & {
  postMessage: ReturnType<
    typeof vi.fn<(message: unknown, transfer?: Transferable[] | StructuredSerializeOptions) => void>
  >;
} {
  return {
    postMessage:
      vi.fn<(message: unknown, transfer?: Transferable[] | StructuredSerializeOptions) => void>(),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

describe("browserServiceWorkerTransport", () => {
  afterEach(() => {
    resetLoggerMetaStats();
    vi.restoreAllMocks();
  });

  it("posts default envelopes to the active controller", () => {
    const worker = createWorker();
    const transport = browserServiceWorkerTransport({
      serviceWorker: { controller: worker },
      source: "page-a",
    });

    transport.log?.(event, createContext());
    transport.logBatch?.([{ ...event, id: "evt-2", seq: 2 }], createContext());

    expect(worker.postMessage).toHaveBeenNthCalledWith(
      1,
      { event, source: "page-a", type: "loggerjs.event" },
      undefined,
    );
    expect(worker.postMessage).toHaveBeenNthCalledWith(
      2,
      { events: [{ ...event, id: "evt-2", seq: 2 }], source: "page-a", type: "loggerjs.batch" },
      undefined,
    );
  });

  it("queues messages until serviceWorker.ready resolves", async () => {
    const worker = createWorker();
    const ready = deferred<{ active: BrowserServiceWorkerLike }>();
    const serviceWorker: BrowserServiceWorkerContainerLike = {
      ready: ready.promise,
    };
    const transport = browserServiceWorkerTransport({
      serviceWorker,
      source: "page-a",
      target: "ready",
    });

    transport.log?.(event, createContext());
    expect(transport.queueSize()).toBe(1);

    ready.resolve({ active: worker });
    await ready.promise;
    await Promise.resolve();

    expect(transport.queueSize()).toBe(0);
    expect(worker.postMessage).toHaveBeenCalledWith(
      { event, source: "page-a", type: "loggerjs.event" },
      undefined,
    );
  });

  it("drops newest messages when the ready queue is full", () => {
    const dropped: string[] = [];
    const transport = browserServiceWorkerTransport({
      dropPolicy: "drop-newest",
      maxQueueSize: 1,
      serviceWorker: { ready: new Promise(() => {}) },
      target: "ready",
      onDrop(item, reason) {
        dropped.push(`${item.message}:${reason}`);
      },
    });

    transport.log?.(event, createContext());
    transport.log?.({ ...event, message: "drop" }, createContext());

    expect(transport.queueSize()).toBe(1);
    expect(dropped).toEqual(["drop:queue-full"]);
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.dropped": 1,
      "transport.dropped.queue-full": 1,
    });
  });

  it("reports unavailable controllers", () => {
    const errors: unknown[] = [];
    const onError = vi.fn<(error: unknown, detail: unknown) => void>();
    const transport = browserServiceWorkerTransport({
      serviceWorker: {},
      onError,
    });

    transport.log?.(event, createContext(errors));

    expect(errors).toHaveLength(1);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), {
      droppedEvents: 1,
      operation: "unavailable",
    });
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.dropped": 1,
      "transport.dropped.unavailable": 1,
    });
  });
});
