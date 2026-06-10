import { describe, expect, it, vi } from "vitest";
import type { LogEvent, TransportContext } from "@loggerjs/core";
import { stdoutTransport } from "../src";

const event: LogEvent = {
  id: "evt-1",
  time: 1,
  seq: 1,
  level: 30,
  levelName: "info",
  logger: "test",
  message: "created",
};

const context: TransportContext = {
  loggerName: "test",
  now: () => 1,
  reportInternalError: vi.fn<TransportContext["reportInternalError"]>(),
};

describe("stdoutTransport", () => {
  it("waits for pending write callbacks on flush", async () => {
    const callbacks: Array<() => void> = [];
    const transport = stdoutTransport({
      stream: {
        write(_chunk, callback) {
          if (callback) callbacks.push(() => callback());
          return true;
        },
      },
    });

    transport.log?.(event, context);
    let flushed = false;
    const flushPromise = transport.flush?.()?.then(() => {
      flushed = true;
    });

    await Promise.resolve();
    expect(flushed).toBe(false);
    callbacks[0]?.();
    await flushPromise;
    expect(flushed).toBe(true);
  });

  it("waits for drain when the stream applies backpressure", async () => {
    const drains: Array<() => void> = [];
    const transport = stdoutTransport({
      stream: {
        write(_chunk, callback) {
          callback?.();
          return false;
        },
        once(eventName, listener) {
          if (eventName === "drain") drains.push(listener);
        },
      },
    });

    transport.log?.(event, context);
    let flushed = false;
    const flushPromise = transport.flush?.()?.then(() => {
      flushed = true;
    });

    await Promise.resolve();
    expect(flushed).toBe(false);
    drains[0]?.();
    await flushPromise;
    expect(flushed).toBe(true);
  });
});
