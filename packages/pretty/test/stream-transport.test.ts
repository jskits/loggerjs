import { describe, expect, it, vi } from "vitest";
import { prettyStderrTransport, prettyStdoutTransport, prettyStreamTransport } from "../src";
import type { LogEvent, TransportContext } from "@loggerjs/core";
import type { PrettyWritableLike } from "../src";

type StreamWrite = PrettyWritableLike["write"];
type StreamOff = NonNullable<PrettyWritableLike["off"]>;

function event(patch: Partial<LogEvent> = {}): LogEvent {
  return {
    id: "evt-1",
    time: Date.UTC(2026, 0, 2, 3, 4, 5, 678),
    seq: 1,
    level: 30,
    levelName: "info",
    logger: "app",
    message: "ready",
    data: { port: 3000 },
    ...patch,
  };
}

function context(source: LogEvent = event()): TransportContext {
  return {
    loggerName: "app",
    now: () => source.time,
    toEvent: () => source,
    reportInternalError: vi.fn<TransportContext["reportInternalError"]>(),
  };
}

describe("prettyStreamTransport", () => {
  it("writes plain lines to non-TTY streams by default", () => {
    const write = vi.fn<StreamWrite>(() => true);
    const transport = prettyStreamTransport({ stream: { write }, process: { env: {} } });

    transport.log?.(event(), context());

    expect(write).toHaveBeenCalledWith(expect.stringContaining("INFO"));
    expect(write).toHaveBeenCalledWith(expect.not.stringContaining("\x1b["));
  });

  it("writes ANSI colored lines for TTY streams", () => {
    const write = vi.fn<StreamWrite>(() => true);
    const transport = prettyStreamTransport({
      stream: { isTTY: true, write },
      process: { env: {} },
    });

    transport.log?.(event({ levelName: "warn", level: 40 }), context());

    expect(write).toHaveBeenCalledWith(expect.stringContaining("\x1b[33mWARN"));
  });

  it("honors NO_COLOR and FORCE_COLOR", () => {
    const noColorWrite = vi.fn<StreamWrite>(() => true);
    prettyStreamTransport({
      stream: { isTTY: true, write: noColorWrite },
      process: { env: { NO_COLOR: "1" } },
    }).log?.(event({ levelName: "warn", level: 40 }), context());

    const forcedWrite = vi.fn<StreamWrite>(() => true);
    prettyStreamTransport({
      stream: { write: forcedWrite },
      process: { env: { FORCE_COLOR: "1" } },
    }).log?.(event({ levelName: "error", level: 50 }), context());

    expect(noColorWrite).toHaveBeenCalledWith(expect.not.stringContaining("\x1b["));
    expect(forcedWrite).toHaveBeenCalledWith(expect.stringContaining("\x1b[31mERROR"));
  });

  it("filters below minLevel", () => {
    const write = vi.fn<StreamWrite>(() => true);
    const transport = prettyStreamTransport({ stream: { write }, minLevel: "warn" });

    transport.log?.(event({ levelName: "info", level: 30 }), context());
    transport.log?.(event({ levelName: "warn", level: 40 }), context());

    expect(write).toHaveBeenCalledTimes(1);
  });

  it("waits for drain when the stream reports backpressure", async () => {
    const listeners: Array<() => void> = [];
    const stream: PrettyWritableLike = {
      write: vi.fn<StreamWrite>(() => false),
      once: (_event, listener) => {
        listeners.push(listener);
      },
    };
    const transport = prettyStreamTransport({ stream });

    transport.log?.(event(), context());
    const flushed = vi.fn<() => void>();
    const flush = Promise.resolve(transport.flush?.()).then(flushed);

    expect(flushed).not.toHaveBeenCalled();
    listeners[0]?.();
    await flush;

    expect(flushed).toHaveBeenCalled();
  });

  it("uses stdout and stderr process streams", () => {
    const stdoutWrite = vi.fn<StreamWrite>(() => true);
    const stderrWrite = vi.fn<StreamWrite>(() => true);
    const process = {
      stdout: { write: stdoutWrite },
      stderr: { write: stderrWrite },
      env: {},
    };

    prettyStdoutTransport({ process }).log?.(event(), context());
    prettyStderrTransport({ process }).log?.(event(), context());

    expect(stdoutWrite).toHaveBeenCalledTimes(1);
    expect(stderrWrite).toHaveBeenCalledTimes(1);
  });

  it("throws a clear setup error when process streams are missing", () => {
    expect(() => prettyStdoutTransport({ process: { env: {} } })).toThrow(
      "pretty stdout transport requires a writable stream or process.stdout",
    );
    expect(() => prettyStderrTransport({ process: { env: {} } })).toThrow(
      "pretty stderr transport requires a writable stream or process.stderr",
    );
  });

  it("reports synchronous write errors and rejects flush", async () => {
    const error = new Error("write failed");
    const reportInternalError = vi.fn<TransportContext["reportInternalError"]>();
    const transportContext: TransportContext = {
      ...context(),
      reportInternalError,
    };
    const stream: PrettyWritableLike = {
      write: vi.fn<StreamWrite>(() => {
        throw error;
      }),
    };
    const transport = prettyStreamTransport({ name: "pretty-test", stream });

    transport.log?.(event(), transportContext);

    await expect(transport.flush?.()).rejects.toBe(error);
    expect(reportInternalError).toHaveBeenCalledWith(error, {
      operation: "write",
      phase: "transport",
      transport: "pretty-test",
    });
  });

  it("rejects pending flushes when the stream errors before drain", async () => {
    let errorListener: ((error: Error) => void) | undefined;
    let drainListener: (() => void) | undefined;
    const error = new Error("stream failed");
    const stream: PrettyWritableLike = {
      write: vi.fn<StreamWrite>(() => false),
      on: (_event, listener) => {
        errorListener = listener;
      },
      once: (_event, listener) => {
        drainListener = listener;
      },
    };
    const transport = prettyStreamTransport({ stream });

    transport.log?.(event(), context());
    const flushed = transport.flush?.();
    errorListener?.(error);
    drainListener?.();

    await expect(flushed).rejects.toBe(error);
  });

  it("treats false writes without drain support as synchronously accepted", async () => {
    const write = vi.fn<StreamWrite>(() => false);
    const transport = prettyStreamTransport({ stream: { write } });

    transport.log?.(event(), context());

    await expect(transport.flush?.()).resolves.toBeUndefined();
  });

  it("detaches stream error listeners, ends on close, and stops future writes", async () => {
    const write = vi.fn<StreamWrite>(() => true);
    const off = vi.fn<StreamOff>();
    const end = vi.fn<NonNullable<PrettyWritableLike["end"]>>((callback) => {
      callback?.();
    });
    const stream: PrettyWritableLike = {
      write,
      off,
      end,
      on: vi.fn<NonNullable<PrettyWritableLike["on"]>>(),
    };
    const transport = prettyStreamTransport({ stream, endOnClose: true });

    transport.log?.(event({ message: "before" }), context());
    await transport.close?.();
    transport.log?.(event({ message: "after" }), context());

    expect(off).toHaveBeenCalledWith("error", expect.any(Function));
    expect(end).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("propagates stream end errors on close", async () => {
    const error = new Error("end failed");
    const stream: PrettyWritableLike = {
      write: vi.fn<StreamWrite>(() => true),
      end: vi.fn<NonNullable<PrettyWritableLike["end"]>>((callback) => {
        callback?.(error);
      }),
    };
    const transport = prettyStreamTransport({ stream, endOnClose: true });

    await expect(transport.close?.()).rejects.toBe(error);
  });
});
