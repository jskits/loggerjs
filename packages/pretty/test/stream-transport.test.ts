import { describe, expect, it, vi } from "vitest";
import { prettyStderrTransport, prettyStdoutTransport, prettyStreamTransport } from "../src";
import type { LogEvent, TransportContext } from "@loggerjs/core";
import type { PrettyWritableLike } from "../src";

type StreamWrite = PrettyWritableLike["write"];

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
});
