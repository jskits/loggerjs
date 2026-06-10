import { afterEach, describe, expect, it, vi } from "vitest";
import type { LoggerLike } from "@loggerjs/core";
import { captureProcessIntegration } from "../src";

const nodeProcess = process as typeof process & {
  listenerCount: (event: string) => number;
};

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

describe("captureProcessIntegration", () => {
  const teardowns: Array<() => void> = [];

  afterEach(() => {
    while (teardowns.length > 0) {
      teardowns.pop()?.();
    }
  });

  it("removes process listeners on teardown", () => {
    const before = nodeProcess.listenerCount("warning");
    const teardown = captureProcessIntegration({
      uncaughtException: false,
      unhandledRejection: false,
      warning: true,
      beforeExitFlush: false,
    }).setup(createLogger());

    expect(typeof teardown).toBe("function");
    if (typeof teardown === "function") teardowns.push(teardown);

    expect(nodeProcess.listenerCount("warning")).toBe(before + 1);

    teardowns.pop()?.();

    expect(nodeProcess.listenerCount("warning")).toBe(before);
  });
});
