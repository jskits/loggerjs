import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMiddleware,
  createLogger,
  getLoggerMetaStats,
  memoryTransport,
  resetLoggerMetaStats,
  type LogEvent,
  type Processor,
  type Transport,
} from "../src";

const failingProcessor: Processor = () => {
  throw new Error("processor failed");
};

function eventMessages(events: LogEvent[]): string[] {
  return events.map((event) => event.message);
}

describe("logger core skeleton", () => {
  afterEach(() => {
    resetLoggerMetaStats();
  });

  it("prefers category over legacy name options", () => {
    const transport = memoryTransport();

    const logger = createLogger({
      name: "legacy",
      category: ["api", "orders"],
      transports: [transport],
    });

    logger.info("created");

    expect(transport.events[0]?.logger).toBe("api.orders");
  });

  it("lets child loggers override the category", () => {
    const transport = memoryTransport();
    const logger = createLogger({
      category: "api",
      transports: [transport],
    });

    logger.child({ category: ["api", "checkout"] }).info("paid");

    expect(transport.events[0]?.logger).toBe("api.checkout");
  });

  it("resolves enabled lazy messages once through the record path", () => {
    const transport = memoryTransport();
    const lazyMessage = vi.fn<() => string>(() => "debug details");
    const logger = createLogger({
      level: "debug",
      transports: [transport],
    });

    logger.debug(lazyMessage, { state: "ready" });

    expect(lazyMessage).toHaveBeenCalledTimes(1);
    expect(transport.events[0]).toMatchObject({
      levelName: "debug",
      message: "debug details",
      data: { state: "ready" },
    });
  });

  it("supports error-first logging with explicit message and props", () => {
    const transport = memoryTransport();
    const error = new Error("database timeout");
    const logger = createLogger({
      transports: [transport],
    });

    logger.error(error, "save failed", { orderId: "ord-1" });

    expect(transport.events[0]).toMatchObject({
      levelName: "error",
      message: "save failed",
      data: { orderId: "ord-1" },
      error: {
        name: "Error",
        message: "database timeout",
      },
    });
  });

  it("runs record middleware before compatibility event projection", () => {
    const transport = memoryTransport();
    const logger = createLogger({
      middleware: [
        createMiddleware("enrich", (record) => {
          record.props = { ...record.props, requestId: "req-1" };
          return record;
        }),
      ],
      transports: [transport],
    });

    logger.info("created", { orderId: "ord-1" });

    expect(transport.events[0]?.data).toEqual({
      orderId: "ord-1",
      requestId: "req-1",
    });
  });

  it("stops dispatch when record middleware drops", () => {
    const transport = memoryTransport();
    const idFactory = vi.fn<
      (event: Pick<LogEvent, "time" | "seq" | "levelName" | "logger">) => string
    >(() => "id-1");
    const logger = createLogger({
      idFactory,
      middleware: [createMiddleware("drop", () => null)],
      transports: [transport],
    });

    logger.info("created");

    expect(idFactory).not.toHaveBeenCalled();
    expect(transport.events).toEqual([]);
  });

  it("returns before expensive work for disabled levels", () => {
    const transport = memoryTransport();
    const contextProvider = vi.fn<() => Record<string, unknown>>(() => ({ requestId: "req-1" }));
    const idFactory = vi.fn<
      (event: Pick<LogEvent, "time" | "seq" | "levelName" | "logger">) => string
    >(() => "id-1");
    const processor = vi.fn<Processor>((event) => event);
    const lazyMessage = vi.fn<() => string>(() => "debug details");

    const logger = createLogger({
      level: "warn",
      contextProvider,
      idFactory,
      processors: [processor],
      transports: [transport],
    });

    logger.debug(lazyMessage);

    expect(contextProvider).not.toHaveBeenCalled();
    expect(idFactory).not.toHaveBeenCalled();
    expect(processor).not.toHaveBeenCalled();
    expect(lazyMessage).not.toHaveBeenCalled();
    expect(transport.events).toEqual([]);
  });

  it("keeps dispatching when processors or transports fail", () => {
    const internalErrors: Array<Record<string, unknown> | undefined> = [];
    const transport = memoryTransport();
    const failingTransport: Transport = {
      name: "failing",
      log() {
        throw new Error("transport failed");
      },
    };

    const logger = createLogger({
      processors: [failingProcessor],
      transports: [failingTransport, transport],
      onInternalError: (_error, detail) => {
        internalErrors.push(detail);
      },
    });

    logger.info("order created");

    expect(eventMessages(transport.events)).toEqual(["order created"]);
    expect(internalErrors).toEqual([
      { phase: "processor" },
      { phase: "transport", transport: "failing" },
    ]);
    expect(getLoggerMetaStats()).toMatchObject({
      "processor.errors": 1,
      "transport.errors": 1,
    });
  });

  it("flushes sync-capable transports without letting failures escape", () => {
    const flushSync = vi.fn<() => void>();
    const failingFlushSync = vi.fn<() => void>(() => {
      throw new Error("flush failed");
    });
    const onInternalError = vi.fn<(error: unknown, detail?: Record<string, unknown>) => void>();
    const logger = createLogger({
      transports: [
        { name: "sync", flushSync },
        { name: "failing-sync", flushSync: failingFlushSync },
      ],
      onInternalError,
    });

    expect(() => logger.flushSync()).not.toThrow();

    expect(flushSync).toHaveBeenCalledTimes(1);
    expect(failingFlushSync).toHaveBeenCalledTimes(1);
    expect(onInternalError).toHaveBeenCalledWith(expect.any(Error), {
      phase: "transport",
      transport: "failing-sync",
      operation: "flushSync",
    });
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.errors": 1,
    });
  });
});
