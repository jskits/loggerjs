import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consoleTransport,
  getUnpatchedRegistry,
  recordToEvent,
  type Codec,
  type LogEvent,
  type TransportContext,
} from "../src";

function createEvent(patch: Partial<LogEvent> = {}): LogEvent {
  return {
    id: "event-1",
    time: 0,
    seq: 0,
    level: 30,
    levelName: "info",
    logger: "app",
    message: "created",
    ...patch,
  };
}

function createContext(): TransportContext {
  return {
    loggerName: "test",
    now: () => 0,
    toEvent: recordToEvent,
    reportInternalError: vi.fn<TransportContext["reportInternalError"]>(),
  };
}

function writerCallAt(
  writer: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>,
  index: number,
) {
  const call = writer.mock.calls[index];
  if (!call) throw new Error(`Missing console writer call ${index}`);
  return call;
}

describe("consoleTransport", () => {
  const registry = getUnpatchedRegistry();
  const previousInfo = registry.console.info;

  afterEach(() => {
    registry.console.info = previousInfo;
    vi.restoreAllMocks();
  });

  it("passes raw data and error references in pretty mode", () => {
    const writer = vi.fn<(...args: unknown[]) => void>();
    registry.console.info = writer;
    const data = { orderId: "ord-1" };
    const error = { message: "raw error" };

    consoleTransport().log?.(createEvent({ data, error }), createContext());

    expect(writer).toHaveBeenCalledTimes(1);
    expect(writerCallAt(writer, 0)[2]).toBe(data);
    expect(writerCallAt(writer, 0)[3]).toBe(error);
  });

  it("uses the configured codec in JSON mode", () => {
    const writer = vi.fn<(...args: unknown[]) => void>();
    registry.console.info = writer;
    const codec: Codec<string | Uint8Array> = {
      name: "test-json",
      contentType: "application/json",
      encode: vi.fn<Codec<string | Uint8Array>["encode"]>(() => '{"ok":true}'),
    };

    consoleTransport({ pretty: false, codec }).log?.(createEvent(), createContext());

    expect(codec.encode).toHaveBeenCalledWith(createEvent());
    expect(writer).toHaveBeenCalledWith('{"ok":true}');
  });

  it("filters console capture loop events by default", () => {
    const writer = vi.fn<(...args: unknown[]) => void>();
    registry.console.info = writer;

    consoleTransport().log?.(
      createEvent({ source: { integration: "integration:capture-console" } }),
      createContext(),
    );

    expect(writer).not.toHaveBeenCalled();
  });
});
