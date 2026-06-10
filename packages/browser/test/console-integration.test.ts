import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createIntegrationSetupContext,
  getLoggerMetaStats,
  resetLoggerMetaStats,
  type CaptureInput,
  type IntegrationSetupContext,
  type LoggerLike,
} from "@loggerjs/core";
import { captureConsoleIntegration } from "../src";

const originalWarn = console.warn;
const originalTrace = console.trace;

function createLogger(): LoggerLike {
  return {
    log: vi.fn<LoggerLike["log"]>(),
    trace: vi.fn<LoggerLike["trace"]>(),
    debug: vi.fn<LoggerLike["debug"]>(),
    info: vi.fn<LoggerLike["info"]>(),
    warn: vi.fn<LoggerLike["warn"]>(),
    error: vi.fn<LoggerLike["error"]>(),
    fatal: vi.fn<LoggerLike["fatal"]>(),
    captureException: vi.fn<LoggerLike["captureException"]>(),
    flush: vi.fn<LoggerLike["flush"]>(async () => {}),
    close: vi.fn<LoggerLike["close"]>(async () => {}),
  };
}

function createIntegrationContext(logger: LoggerLike): {
  context: IntegrationSetupContext;
  capture: ReturnType<typeof vi.fn<(input: CaptureInput) => void>>;
} {
  const capture = vi.fn<(input: CaptureInput) => void>();
  const context = createIntegrationSetupContext({
    name: "capture-console",
    logger,
    capture,
    getLogger: () => logger,
  });
  return { context, capture };
}

describe("captureConsoleIntegration", () => {
  afterEach(() => {
    console.warn = originalWarn;
    console.trace = originalTrace;
    resetLoggerMetaStats();
    vi.restoreAllMocks();
  });

  it("captures selected console methods and restores them on teardown", () => {
    const logger = createLogger();
    const { context, capture } = createIntegrationContext(logger);
    const replacementWarn = vi.fn<(...args: unknown[]) => void>();
    console.warn = replacementWarn;

    const teardown = captureConsoleIntegration({
      levels: ["warn"],
      preserveConsole: false,
      captureArguments: true,
    }).setup(context);

    expect(console.warn).not.toBe(replacementWarn);

    console.warn("captured warning", { feature: "demo" });

    expect(capture).toHaveBeenCalledWith({
      level: "warn",
      message: expect.stringContaining("captured warning"),
      props: {
        console: {
          level: "warn",
          arguments: ["captured warning", { feature: "demo" }],
        },
      },
      source: "integration:capture-console",
    });
    expect(logger.log).not.toHaveBeenCalled();
    expect(replacementWarn).not.toHaveBeenCalled();

    expect(typeof teardown).toBe("function");
    if (typeof teardown === "function") teardown();

    expect(console.warn).toBe(replacementWarn);
  });

  it("captures trace by default without preserving raw arguments unless enabled", () => {
    const logger = createLogger();
    const { context, capture } = createIntegrationContext(logger);
    const replacementTrace = vi.fn<(...args: unknown[]) => void>();
    console.trace = replacementTrace;

    const teardown = captureConsoleIntegration({
      preserveConsole: false,
    }).setup(context);

    console.trace("trace message", { feature: "demo" });

    expect(capture).toHaveBeenCalledWith({
      level: "trace",
      message: expect.stringContaining("trace message"),
      props: {
        console: {
          level: "trace",
        },
      },
      source: "integration:capture-console",
    });
    expect(replacementTrace).not.toHaveBeenCalled();

    if (typeof teardown === "function") teardown();
    expect(console.trace).toBe(replacementTrace);
  });

  it("rate limits console capture and counts dropped records", () => {
    const logger = createLogger();
    const { context, capture } = createIntegrationContext(logger);
    const replacementWarn = vi.fn<(...args: unknown[]) => void>();
    console.warn = replacementWarn;

    const teardown = captureConsoleIntegration({
      levels: ["warn"],
      preserveConsole: false,
      maxCapturesPerSecond: 1,
    }).setup(context);

    console.warn("first");
    console.warn("second");

    expect(capture).toHaveBeenCalledTimes(1);
    expect(getLoggerMetaStats()).toMatchObject({
      "integration.dropped": 1,
      "integration.dropped.rate-limit": 1,
    });

    if (typeof teardown === "function") teardown();
  });
});
