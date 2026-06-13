import { describe, expect, it, vi } from "vitest";
import { recordToEvent, type LogEvent, type TransportContext } from "@loggerjs/core";
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
  toEvent: recordToEvent,
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

  it("buffers writes until minLength is reached", async () => {
    const chunks: Array<string | Uint8Array> = [];
    const payloads = ["abc", "def"];
    const transport = stdoutTransport({
      minLength: 6,
      codec: {
        name: "message",
        contentType: "text/plain",
        encode: () => payloads.shift() ?? "",
      },
      stream: {
        write(chunk, callback) {
          chunks.push(chunk);
          callback?.();
          return true;
        },
      },
    });

    transport.log?.({ ...event, message: "abc" }, context);
    expect(chunks).toEqual([]);

    transport.log?.({ ...event, message: "def" }, context);
    await transport.flush?.();

    expect(chunks).toEqual(["abcdef"]);
  });

  it("treats EPIPE as a clean stdout shutdown by default", async () => {
    const reportInternalError = vi.fn<TransportContext["reportInternalError"]>();
    const error = new Error("closed pipe") as Error & { code: string };
    error.code = "EPIPE";
    const transport = stdoutTransport({
      stream: {
        write() {
          throw error;
        },
      },
    });

    transport.log?.(event, { ...context, reportInternalError });

    await expect(transport.flush?.()).resolves.toBeUndefined();
    expect(reportInternalError).not.toHaveBeenCalled();
  });

  it("reports non-EPIPE write failures and rejects flush", async () => {
    const reportInternalError = vi.fn<TransportContext["reportInternalError"]>();
    const error = new Error("stream failed");
    const transport = stdoutTransport({
      stream: {
        write() {
          throw error;
        },
      },
    });

    transport.log?.(event, { ...context, reportInternalError });

    await expect(transport.flush?.()).rejects.toThrow("stream failed");
    expect(reportInternalError).toHaveBeenCalledWith(error, {
      phase: "transport",
      transport: "stdout",
      operation: "write",
    });
  });
});
