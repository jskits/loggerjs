import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createIntegrationSetupContext,
  createLogger,
  getLoggerMetaStats,
  memoryTransport,
  resetLoggerMetaStats,
  type Integration,
  type IntegrationSetupContext,
  type LoggerLike,
} from "../src";

describe("integration API", () => {
  afterEach(() => {
    resetLoggerMetaStats();
  });

  it("captures integration records through the logger pipeline", () => {
    const transport = memoryTransport();
    const integration: Integration = {
      name: "custom",
      setup(api: IntegrationSetupContext) {
        api.capture({
          level: "warn",
          message: "captured by integration",
          props: { feature: "demo" },
        });
      },
    };

    createLogger({
      transports: [transport],
      integrations: [integration],
    });

    expect(transport.events[0]).toMatchObject({
      levelName: "warn",
      logger: "app",
      message: "captured by integration",
      data: { feature: "demo" },
      source: { integration: "integration:custom" },
    });
  });

  it("guards synchronous reentrant integration capture", () => {
    let guarded: (() => void) | undefined;
    let calls = 0;
    const integration: Integration = {
      name: "guarded",
      setup(api: IntegrationSetupContext) {
        guarded = api.guard(() => {
          calls += 1;
          guarded?.();
        });
        guarded();
      },
    };

    createLogger({
      integrations: [integration],
    });

    expect(calls).toBe(1);
    expect(getLoggerMetaStats()).toMatchObject({
      "integration.dropped": 1,
      "integration.dropped.reentrant": 1,
    });
  });

  it("sets up and tears down the same integration instance once", async () => {
    const setup = vi.fn<(api: IntegrationSetupContext) => () => void>(() => teardown);
    const teardown = vi.fn<() => void>();
    const integration: Integration = {
      name: "idempotent",
      setup,
    };

    const logger = createLogger({
      integrations: [integration, integration],
    });
    logger.addIntegration(integration);
    await logger.close();
    await logger.close();

    expect(setup).toHaveBeenCalledTimes(1);
    expect(teardown).toHaveBeenCalledTimes(1);
  });

  it("proxies the full logger facade and unpatched registry through setup context", async () => {
    const logger: LoggerLike = {
      log: vi.fn<LoggerLike["log"]>(),
      trace: vi.fn<LoggerLike["trace"]>(),
      debug: vi.fn<LoggerLike["debug"]>(),
      info: vi.fn<LoggerLike["info"]>(),
      warn: vi.fn<LoggerLike["warn"]>(),
      error: vi.fn<LoggerLike["error"]>(),
      fatal: vi.fn<LoggerLike["fatal"]>(),
      captureException: vi.fn<LoggerLike["captureException"]>(),
      event: vi.fn<LoggerLike["event"]>() as LoggerLike["event"],
      ready: vi.fn<LoggerLike["ready"]>(async () => {}),
      flush: vi.fn<LoggerLike["flush"]>(async () => {}),
      flushSync: vi.fn<NonNullable<LoggerLike["flushSync"]>>(),
      close: vi.fn<LoggerLike["close"]>(async () => {}),
    };
    const captured: unknown[] = [];
    const getLogger = vi.fn<() => LoggerLike>(() => logger);
    const context = createIntegrationSetupContext({
      name: "facade",
      logger,
      capture: (input) => {
        captured.push(input);
      },
      getLogger,
    });
    const previousFetch = context.unpatched.fetch;
    const previousXmlHttpRequest = context.unpatched.XMLHttpRequest;

    try {
      const unpatchedFetch = vi.fn<(...args: unknown[]) => unknown>();
      const unpatchedXmlHttpRequest = { name: "XMLHttpRequestStub" };
      context.unpatched.fetch = unpatchedFetch;
      context.unpatched.XMLHttpRequest = unpatchedXmlHttpRequest;
      expect(context.unpatched.fetch).toBe(unpatchedFetch);
      expect(context.unpatched.XMLHttpRequest).toBe(unpatchedXmlHttpRequest);
      expect(context.unpatched.set("custom-key", { ok: true })).toEqual({ ok: true });
      expect(context.unpatched.get("custom-key")).toEqual({ ok: true });

      context.log("info", "via log");
      context.trace("via trace");
      context.debug("via debug");
      context.info("via info");
      context.warn("via warn");
      context.error("via error");
      context.fatal("via fatal");
      context.captureException(new Error("boom"));
      context.event({ type: "custom" }, { ok: true });
      await context.ready();
      await context.flush();
      context.flushSync?.();
      await context.close();
      context.capture({ level: "warn", message: "captured" });
      expect(context.getLogger(["child"])).toBe(logger);

      expect(logger.log).toHaveBeenCalledWith("info", "via log");
      expect(logger.trace).toHaveBeenCalledWith("via trace");
      expect(logger.debug).toHaveBeenCalledWith("via debug");
      expect(logger.info).toHaveBeenCalledWith("via info");
      expect(logger.warn).toHaveBeenCalledWith("via warn");
      expect(logger.error).toHaveBeenCalledWith("via error");
      expect(logger.fatal).toHaveBeenCalledWith("via fatal");
      expect(logger.captureException).toHaveBeenCalledWith(expect.any(Error));
      expect(logger.event).toHaveBeenCalledWith({ type: "custom" }, { ok: true });
      expect(logger.ready).toHaveBeenCalledTimes(1);
      expect(logger.flush).toHaveBeenCalledTimes(1);
      expect(logger.flushSync).toHaveBeenCalledTimes(1);
      expect(logger.close).toHaveBeenCalledTimes(1);
      expect(getLogger).toHaveBeenCalledWith(["child"]);
      expect(captured).toEqual([
        { level: "warn", message: "captured", source: "integration:facade" },
      ]);
    } finally {
      context.unpatched.fetch = previousFetch;
      context.unpatched.XMLHttpRequest = previousXmlHttpRequest;
    }
  });
});
