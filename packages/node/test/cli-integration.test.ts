import { describe, expect, it, vi } from "vitest";
import {
  createIntegrationSetupContext,
  type CaptureInput,
  type IntegrationSetupContext,
  type LoggerLike,
} from "@loggerjs/core";
import { captureCliIntegration, type CliProcessLike } from "../src";

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
    event: () => {},
    flush: vi.fn<LoggerLike["flush"]>(async () => {}),
    close: vi.fn<LoggerLike["close"]>(async () => {}),
  };
}

function createIntegrationContext(): {
  context: IntegrationSetupContext;
  capture: ReturnType<typeof vi.fn<(input: CaptureInput) => void>>;
} {
  const logger = createLogger();
  const capture = vi.fn<(input: CaptureInput) => void>();
  const context = createIntegrationSetupContext({
    name: "capture-cli",
    logger,
    capture,
    getLogger: () => logger,
  });
  return { context, capture };
}

function fakeProcess(): CliProcessLike & {
  emit: (event: string, ...args: unknown[]) => void;
  listenerCount: (event: string) => number;
} {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    argv: ["/usr/bin/node", "bin/logger", "--api-token=secret", "--verbose"],
    cwd: () => "/repo",
    env: {
      NODE_ENV: "test",
      SECRET: "hidden",
    },
    emit(event, ...args) {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
    listenerCount(event) {
      return listeners.get(event)?.length ?? 0;
    },
    on(event, listener) {
      const items = listeners.get(event) ?? [];
      items.push(listener);
      listeners.set(event, items);
    },
    off(event, listener) {
      const items = listeners.get(event) ?? [];
      listeners.set(
        event,
        items.filter((item) => item !== listener),
      );
    },
  };
}

describe("captureCliIntegration", () => {
  it("captures CLI start with sanitized argv and env allowlist", () => {
    const processLike = fakeProcess();
    const { context, capture } = createIntegrationContext();
    const teardown = captureCliIntegration({
      captureEnv: ["NODE_ENV"],
      process: processLike,
    }).setup(context);

    expect(capture).toHaveBeenCalledWith({
      level: "info",
      message: "CLI start bin/logger",
      props: {
        cli: {
          kind: "cli",
          command: "bin/logger",
          argv: ["/usr/bin/node", "bin/logger", "--api-token=[redacted]", "--verbose"],
          cwd: "/repo",
          env: { NODE_ENV: "test" },
          lifecycle: "start",
        },
      },
      source: "integration:capture-cli",
    });

    if (typeof teardown === "function") teardown();
  });

  it("captures exit and signals and removes listeners on teardown", () => {
    const processLike = fakeProcess();
    const { context, capture } = createIntegrationContext();
    const teardown = captureCliIntegration({
      captureStart: false,
      process: processLike,
      signals: ["SIGTERM"],
    }).setup(context);

    expect(processLike.listenerCount("exit")).toBe(1);
    expect(processLike.listenerCount("SIGTERM")).toBe(1);

    processLike.emit("exit", 2);
    processLike.emit("SIGTERM");

    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "error",
        message: "CLI exit 2",
      }),
    );
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message: "CLI signal SIGTERM",
      }),
    );

    if (typeof teardown === "function") teardown();
    expect(processLike.listenerCount("exit")).toBe(0);
    expect(processLike.listenerCount("SIGTERM")).toBe(0);
  });
});
