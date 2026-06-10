import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMiddleware,
  defineEvent,
  createLogger,
  getLoggerMetaStats,
  memoryTransport,
  resetContextManager,
  resetLoggerMetaStats,
  setContextProvider,
  type LogEvent,
  type Processor,
  type Transport,
  withContext,
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
    setContextProvider(undefined);
    resetContextManager();
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

  it("merges ambient context into emitted events", () => {
    const transport = memoryTransport();
    const logger = createLogger({
      transports: [transport],
    });

    withContext({ requestId: "req-1" }, () => logger.info("created"));
    logger.info("outside");

    expect(transport.events[0]?.context).toEqual({ requestId: "req-1" });
    expect(transport.events[1]?.context).toBeUndefined();
  });

  it("lets explicit bindings override ambient context conflicts", () => {
    const transport = memoryTransport();
    const logger = createLogger({
      bindings: { requestId: "explicit", tenantId: "tenant-1" },
      contextProvider: () => ({ providerKey: "provider", tenantId: "tenant-2" }),
      transports: [transport],
    });

    setContextProvider(() => ({ requestId: "ambient", globalKey: "global" }));
    withContext({ requestId: "scope", scopeKey: "scope" }, () => logger.info("created"));

    expect(transport.events[0]?.context).toEqual({
      requestId: "explicit",
      globalKey: "global",
      scopeKey: "scope",
      tenantId: "tenant-2",
      providerKey: "provider",
    });
  });

  it("emits typed event definitions with payload data and event type", () => {
    const transport = memoryTransport();
    const logger = createLogger({
      tags: { service: "checkout" },
      transports: [transport],
    });
    const orderCreated = defineEvent<{ orderId: string; total: number }>({
      type: "order.created",
      level: "info",
      message: (payload) => `Order ${payload.orderId} created`,
      tags: (payload) => ({ highValue: payload.total > 100 }),
    });

    logger.event(orderCreated, { orderId: "ord-1", total: 125 }, { tags: { region: "us" } });

    expect(transport.events[0]).toMatchObject({
      levelName: "info",
      type: "order.created",
      message: "Order ord-1 created",
      data: { orderId: "ord-1", total: 125 },
      tags: {
        service: "checkout",
        highValue: true,
        region: "us",
      },
    });
  });

  it("type-checks event payloads", () => {
    const logger = createLogger();
    const orderCreated = defineEvent<{ orderId: string }>({
      type: "order.created",
    });
    const typeCheckOnly = false as boolean;

    if (typeCheckOnly) {
      logger.event(orderCreated, { orderId: "ord-1" });
      // @ts-expect-error missing required event payload field
      logger.event(orderCreated, {});
    }

    expect(orderCreated.type).toBe("order.created");
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
