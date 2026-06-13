import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMiddleware,
  defineEvent,
  createLogger,
  getLoggerMetaStats,
  LOGGERJS_ROUTE,
  memoryTransport,
  resetContextManager,
  resetLoggerMetaStats,
  setContextProvider,
  type LogEvent,
  type LogRecord,
  type Processor,
  type Transport,
  withLogEventRoute,
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

  it("dispatches records to write transports without event projection", () => {
    const records: LogRecord[] = [];
    const lazyMessage = vi.fn<() => string>(() => "debug details");
    const idFactory = vi.fn<
      (event: Pick<LogEvent, "time" | "seq" | "levelName" | "logger">) => string
    >(() => "id-1");
    const transport: Transport = {
      name: "record",
      write(record) {
        records.push(record);
      },
    };
    const logger = createLogger({
      level: "debug",
      type: "app.event",
      tags: { service: "api" },
      idFactory,
      transports: [transport],
    });

    logger.debug(lazyMessage, { state: "ready" });

    expect(lazyMessage).not.toHaveBeenCalled();
    expect(idFactory).not.toHaveBeenCalled();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      level: 20,
      type: "app.event",
      tags: { service: "api" },
      msg: null,
      props: { state: "ready" },
    });
    expect(records[0]?.lazy).toBe(lazyMessage);
  });

  it("projects records to events on transport demand and caches the result", () => {
    const lazyMessage = vi.fn<() => string>(() => "debug details");
    const idFactory = vi.fn<
      (event: Pick<LogEvent, "time" | "seq" | "levelName" | "logger">) => string
    >((event) => `event-${event.seq}`);
    const events: LogEvent[] = [];
    const log = vi.fn<NonNullable<Transport["log"]>>();
    const transport: Transport = {
      name: "record",
      write(record, context) {
        events.push(context.toEvent(record), context.toEvent(record));
      },
      log,
    };
    const logger = createLogger({
      level: "debug",
      idFactory,
      transports: [transport],
    });

    logger.debug(lazyMessage);

    expect(log).not.toHaveBeenCalled();
    expect(lazyMessage).toHaveBeenCalledTimes(1);
    expect(idFactory).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(2);
    expect(events[0]).toBe(events[1]);
    expect(events[0]).toMatchObject({
      id: expect.stringMatching(/^event-/),
      levelName: "debug",
      message: "debug details",
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

  it("shares frozen logger tags across records without cross-record leaks", () => {
    const transport = memoryTransport();
    const onInternalError = vi.fn<(error: unknown, detail?: Record<string, unknown>) => void>();
    const logger = createLogger({
      tags: { service: "checkout" },
      onInternalError,
      middleware: [
        createMiddleware("tag-once", (record) => {
          if (record.msg === "first") record.tags = { ...record.tags, attempt: "1" };
          if (record.msg === "mutate") {
            // In-place mutation violates the contract; the frozen object must
            // throw here instead of leaking the tag into later records.
            (record.tags as Record<string, string>).leak = "yes";
          }
          return record;
        }),
      ],
      transports: [transport],
    });

    logger.info("first");
    logger.info("mutate");
    logger.info("second");

    expect(transport.events[0]?.tags).toEqual({ service: "checkout", attempt: "1" });
    expect(transport.events[1]?.tags).toEqual({ service: "checkout" });
    expect(transport.events[2]?.tags).toEqual({ service: "checkout" });
    expect(onInternalError).toHaveBeenCalledWith(
      expect.any(TypeError),
      expect.objectContaining({ phase: "middleware" }),
    );
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

  it("reports async transport rejections without wrapping sync results", async () => {
    const internalErrors: Array<Record<string, unknown> | undefined> = [];
    const rejectingTransport: Transport = {
      name: "rejecting",
      async log() {
        throw new Error("async transport failed");
      },
    };
    const logger = createLogger({
      transports: [rejectingTransport],
      onInternalError: (_error, detail) => {
        internalErrors.push(detail);
      },
    });

    logger.info("order created");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(internalErrors).toEqual([{ phase: "transport", transport: "rejecting" }]);
  });

  it("waits for transport readiness only when requested", async () => {
    const ready = vi.fn<() => Promise<void>>(async () => {});
    const log = vi.fn<NonNullable<Transport["log"]>>();
    const logger = createLogger({
      transports: [{ name: "async-sink", ready, log }],
    });

    logger.info("order created");

    expect(log).toHaveBeenCalledTimes(1);
    expect(ready).not.toHaveBeenCalled();

    await logger.ready();

    expect(ready).toHaveBeenCalledTimes(1);
  });

  it("routes events to named transports from processor metadata", () => {
    const local = memoryTransport({ name: "local" });
    const remote = memoryTransport({ name: "remote" });
    const logger = createLogger({
      processors: [(event) => withLogEventRoute(event, { transports: ["remote"] })],
      transports: [local, remote],
    });

    logger.info("created");

    expect(local.events).toEqual([]);
    expect(remote.events).toHaveLength(1);
    expect(Object.keys(remote.events[0] ?? {})).not.toContain(LOGGERJS_ROUTE);
  });

  it("excludes named transports from processor route metadata", () => {
    const local = memoryTransport({ name: "local" });
    const remote = memoryTransport({ name: "remote" });
    const logger = createLogger({
      processors: [(event) => withLogEventRoute(event, { excludeTransports: ["remote"] })],
      transports: [local, remote],
    });

    logger.info("created");

    expect(local.events).toHaveLength(1);
    expect(remote.events).toEqual([]);
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
