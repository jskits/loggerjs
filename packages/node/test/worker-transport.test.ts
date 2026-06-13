import { describe, expect, it, vi } from "vitest";
import {
  getLoggerMetaGauges,
  getLoggerMetaStats,
  recordToEvent,
  resetLoggerMetaStats,
  type Codec,
  type LogEvent,
  type TransportContext,
} from "@loggerjs/core";
import { workerTransport, type WorkerLike, type WorkerTransportMessage } from "../src";

const textCodec: Codec<string | Uint8Array> = {
  name: "text",
  contentType: "text/plain",
  encode(input) {
    const items = Array.isArray(input) ? input : [input];
    return items
      .map((item) => {
        if ("message" in item) return item.message;
        return item.msg ?? "";
      })
      .join("|");
  },
};

const event: LogEvent = {
  id: "evt-1",
  time: 1,
  seq: 1,
  level: 30,
  levelName: "info",
  logger: "test",
  message: "created",
};

function createContext(errors: unknown[] = []): TransportContext {
  return {
    loggerName: "test",
    now: () => 1,
    toEvent: recordToEvent,
    reportInternalError(error) {
      errors.push(error);
    },
  };
}

type WorkerEventName = "error" | "exit" | "message";

class FakeWorker implements WorkerLike {
  messages: Array<{ value: unknown; transferList?: ArrayBuffer[] }> = [];
  listeners = new Map<WorkerEventName, Array<(...args: unknown[]) => void>>();
  postMessage = vi.fn<WorkerLike["postMessage"]>((value, transferList) => {
    this.messages.push({ value, transferList });
  });
  terminate = vi.fn<NonNullable<WorkerLike["terminate"]>>(async () => 0);

  on(eventName: WorkerEventName, listener: (...args: unknown[]) => void) {
    const listeners = this.listeners.get(eventName) ?? [];
    listeners.push(listener);
    this.listeners.set(eventName, listeners);
  }

  off(eventName: WorkerEventName, listener: (...args: unknown[]) => void) {
    const listeners = this.listeners.get(eventName) ?? [];
    this.listeners.set(
      eventName,
      listeners.filter((item) => item !== listener),
    );
  }

  emit(eventName: WorkerEventName, ...args: unknown[]) {
    for (const listener of this.listeners.get(eventName) ?? []) listener(...args);
  }
}

describe("workerTransport", () => {
  it("posts encoded Uint8Array payloads with transfer lists", async () => {
    const postMessage = vi.fn<WorkerLike["postMessage"]>();
    const transport = workerTransport({
      worker: { postMessage },
      codec: textCodec,
    });

    await transport.log?.(event, createContext());

    expect(postMessage).toHaveBeenCalledTimes(1);
    const [message, transferList] = postMessage.mock.calls[0] ?? [];
    const workerMessage = message as WorkerTransportMessage;
    expect(workerMessage).toMatchObject({
      type: "loggerjs:batch",
      codec: "text",
      contentType: "text/plain",
      count: 1,
    });
    expect(workerMessage.payload).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(workerMessage.payload)).toBe("created");
    expect(transferList).toHaveLength(1);
    expect(transferList?.[0]).toBe(workerMessage.payload.buffer);
  });

  it("falls back inline when worker posting fails", async () => {
    const errors: unknown[] = [];
    const logBatch = vi.fn<NonNullable<ReturnType<typeof workerTransport>["logBatch"]>>(
      async () => {},
    );
    const transport = workerTransport({
      worker: {
        postMessage() {
          throw new Error("worker unavailable");
        },
      },
      codec: textCodec,
      fallback: {
        name: "fallback",
        logBatch,
      },
    });

    await transport.log?.(event, createContext(errors));

    expect(logBatch).toHaveBeenCalledWith([event], expect.any(Object));
    expect(errors).toHaveLength(1);
  });

  it("falls back when a worker never becomes ready", async () => {
    const worker = new FakeWorker();
    const errors: unknown[] = [];
    const logBatch = vi.fn<NonNullable<ReturnType<typeof workerTransport>["logBatch"]>>(
      async () => {},
    );
    const transport = workerTransport({
      worker,
      codec: textCodec,
      readyTimeoutMs: 1,
      fallback: {
        name: "fallback",
        logBatch,
      },
    });

    await transport.log?.(event, createContext(errors));

    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(logBatch).toHaveBeenCalledWith([event], expect.any(Object));
    expect(errors[0]).toBeInstanceOf(Error);
  });

  it("exposes explicit readiness for worker startup", async () => {
    resetLoggerMetaStats();
    const worker = new FakeWorker();
    const transport = workerTransport({
      worker,
      codec: textCodec,
      readyTimeoutMs: 1000,
    });

    let settled = false;
    const readyPromise = Promise.resolve(transport.ready?.()).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    worker.emit("message", { type: "loggerjs:ready" });
    await readyPromise;

    expect(settled).toBe(true);
    expect(getLoggerMetaGauges()).toMatchObject({
      "transport.ready.worker": 1,
    });
  });

  it("rejects explicit readiness when the worker never becomes ready", async () => {
    resetLoggerMetaStats();
    const worker = new FakeWorker();
    const transport = workerTransport({
      worker,
      codec: textCodec,
      readyTimeoutMs: 1,
    });

    await expect(transport.ready?.()).rejects.toThrow("workerTransport ready timeout");

    expect(getLoggerMetaStats()).toMatchObject({
      "transport.worker.failed": 1,
    });
  });

  it("waits for batch ack during flush", async () => {
    resetLoggerMetaStats();
    const worker = new FakeWorker();
    const transport = workerTransport({
      worker,
      codec: textCodec,
      readyTimeoutMs: 1000,
      ackTimeoutMs: 1000,
    });

    const logPromise = transport.log?.(event, createContext());
    await Promise.resolve();
    worker.emit("message", { type: "loggerjs:ready" });
    await logPromise;

    const message = worker.messages[0]?.value as WorkerTransportMessage;
    let flushed = false;
    const flushPromise = transport.flush?.()?.then(() => {
      flushed = true;
    });
    await Promise.resolve();
    expect(flushed).toBe(false);

    worker.emit("message", { type: "loggerjs:batch:ack", id: message.id });
    await flushPromise;

    expect(flushed).toBe(true);
    expect(getLoggerMetaStats()).toMatchObject({ "transport.worker.ack": 1 });
    expect(getLoggerMetaGauges()).toMatchObject({
      "transport.ready.worker": 1,
      "transport.queue.depth.worker": 0,
    });
  });

  it("falls back pending batches when the worker exits after ready", async () => {
    resetLoggerMetaStats();
    const worker = new FakeWorker();
    const logBatch = vi.fn<NonNullable<ReturnType<typeof workerTransport>["logBatch"]>>(
      async () => {},
    );
    const transport = workerTransport({
      worker,
      codec: textCodec,
      readyTimeoutMs: 1000,
      ackTimeoutMs: 1000,
      fallback: {
        name: "fallback",
        logBatch,
      },
    });

    const logPromise = transport.log?.(event, createContext());
    await Promise.resolve();
    worker.emit("message", { type: "loggerjs:ready" });
    await logPromise;
    const flushPromise = transport.flush?.();

    worker.emit("exit", 1);
    await flushPromise;

    expect(logBatch).toHaveBeenCalledWith([event], expect.any(Object));
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.worker.failed": 1,
      "transport.worker.pending-dropped": 1,
    });
  });

  it("counts pending batch drops when ack times out without fallback", async () => {
    resetLoggerMetaStats();
    const worker = new FakeWorker();
    const errors: unknown[] = [];
    const transport = workerTransport({
      worker,
      codec: textCodec,
      readyTimeoutMs: 1000,
      ackTimeoutMs: 1,
    });

    const logPromise = transport.log?.(event, createContext(errors));
    await Promise.resolve();
    worker.emit("message", { type: "loggerjs:ready" });
    await logPromise;
    await transport.flush?.();

    expect(errors[0]).toBeInstanceOf(Error);
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.worker.failed": 1,
      "transport.worker.pending-dropped": 1,
      "transport.dropped": 1,
      "transport.dropped.worker-ack-timeout": 1,
    });
  });

  it("can leave the worker running on close", async () => {
    const worker = new FakeWorker();
    const transport = workerTransport({ worker, autoEnd: false });

    await transport.close?.();

    expect(worker.terminate).not.toHaveBeenCalled();
  });

  it("keeps message listeners until pending acks flush on close", async () => {
    const worker = new FakeWorker();
    const transport = workerTransport({
      worker,
      codec: textCodec,
      readyTimeoutMs: 1000,
      ackTimeoutMs: 1000,
    });

    const logPromise = transport.log?.(event, createContext());
    await Promise.resolve();
    worker.emit("message", { type: "loggerjs:ready" });
    await logPromise;

    const message = worker.messages[0]?.value as WorkerTransportMessage;
    let closed = false;
    const closePromise = transport.close?.()?.then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);

    worker.emit("message", { type: "loggerjs:batch:ack", id: message.id });
    await closePromise;

    expect(closed).toBe(true);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("does not expose sync flush", () => {
    const transport = workerTransport({
      worker: {
        postMessage() {},
      },
      codec: textCodec,
    });

    expect(transport.flushSync).toBeUndefined();
  });
});
