import { afterEach, describe, expect, it, vi } from "vitest";
import { createIntegrationSetupContext, type CaptureInput, type LoggerLike } from "@loggerjs/core";
import { captureConsoleIntegration } from "../src";

const originalWarn = console.warn;

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

function createIntegrationContext(logger: LoggerLike) {
  return createIntegrationSetupContext({
    name: "capture-console",
    logger,
    capture: vi.fn<(input: CaptureInput) => void>(),
    getLogger: () => logger,
  });
}

describe("captureConsoleIntegration", () => {
  afterEach(() => {
    console.warn = originalWarn;
    vi.restoreAllMocks();
  });

  it("patches selected console methods and restores them on teardown", () => {
    const logger = createLogger();
    const replacementWarn = vi.fn<(...args: unknown[]) => void>();
    console.warn = replacementWarn;

    const teardown = captureConsoleIntegration({
      levels: ["warn"],
      preserveConsole: false,
    }).setup(createIntegrationContext(logger));

    expect(console.warn).not.toBe(replacementWarn);

    console.warn("captured warning", { feature: "demo" });

    expect(logger.log).toHaveBeenCalledWith("warn", expect.stringContaining("captured warning"), {
      console: {
        level: "warn",
        arguments: ["captured warning", { feature: "demo" }],
      },
    });
    expect(replacementWarn).not.toHaveBeenCalled();

    expect(typeof teardown).toBe("function");
    if (typeof teardown === "function") teardown();

    expect(console.warn).toBe(replacementWarn);
  });
});
