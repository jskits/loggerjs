import { describe, expect, it, vi } from "vitest";
import { prettyConsoleTransport } from "../src";
import type { LogEvent, TransportContext } from "@loggerjs/core";

type ConsoleWriter = (...args: unknown[]) => void;

function event(patch: Partial<LogEvent> = {}): LogEvent {
  return {
    id: "evt-1",
    time: Date.UTC(2026, 0, 2, 3, 4, 5, 678),
    seq: 1,
    level: 50,
    levelName: "error",
    logger: "app",
    message: "failed",
    data: { orderId: "ord_123" },
    ...patch,
  };
}

function context(source: LogEvent): TransportContext {
  return {
    loggerName: "app",
    now: () => source.time,
    toEvent: () => source,
    reportInternalError: vi.fn<TransportContext["reportInternalError"]>(),
  };
}

describe("prettyConsoleTransport", () => {
  it("routes levels to matching console methods", () => {
    const error = vi.fn<ConsoleWriter>();
    const info = vi.fn<ConsoleWriter>();
    const transport = prettyConsoleTransport({
      console: { error, info },
      browserStyles: false,
    });

    transport.log?.(event({ levelName: "error" }), context(event()));
    transport.log?.(event({ levelName: "info", level: 30 }), context(event()));

    expect(error).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain("ERROR");
  });

  it("preserves raw details as separate console arguments", () => {
    const error = vi.fn<ConsoleWriter>();
    const payload = { orderId: "ord_123" };
    const transport = prettyConsoleTransport({
      console: { error },
      browserStyles: false,
    });

    transport.log?.(event({ data: payload }), context(event()));

    expect(error.mock.calls[0]).toContain(payload);
  });

  it("supports browser %c styled output", () => {
    const error = vi.fn<ConsoleWriter>();
    const payload = { orderId: "ord_123" };
    const transport = prettyConsoleTransport({
      console: { error },
      browserStyles: true,
    });

    transport.log?.(event({ data: payload }), context(event()));

    expect(error.mock.calls[0]?.[0]).toContain("%c");
    expect(error.mock.calls[0]).toContain(payload);
  });

  it("filters console-capture loop events by default", () => {
    const error = vi.fn<ConsoleWriter>();
    const transport = prettyConsoleTransport({ console: { error } });

    transport.log?.(
      event({ source: { integration: "integration:capture-console" } }),
      context(event()),
    );

    expect(error).not.toHaveBeenCalled();
  });

  it("projects records through the transport context", () => {
    const error = vi.fn<ConsoleWriter>();
    const source = event();
    const transport = prettyConsoleTransport({
      console: { error },
      browserStyles: false,
    });

    transport.write?.({} as never, context(source));

    expect(error).toHaveBeenCalledWith(expect.stringContaining("ERROR"), source.data);
  });
});
