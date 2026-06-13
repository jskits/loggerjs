import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createIntegrationSetupContext,
  type CaptureInput,
  type IntegrationSetupContext,
  type LoggerLike,
} from "@loggerjs/core";
import { captureProcessIntegration } from "../src";

const nodeProcess = process as typeof process & {
  listenerCount: (event: string) => number;
  listeners: (event: string) => Array<(...args: unknown[]) => void>;
  platform: string;
};
const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../..");
const tsxBin = join(
  repoRoot,
  "node_modules",
  ".bin",
  nodeProcess.platform === "win32" ? "tsx.cmd" : "tsx",
);
const crashFixture = join(testDir, "fixtures", "crash-child.ts");

function createLogger(overrides: Partial<LoggerLike> = {}): LoggerLike {
  return {
    log: vi.fn<LoggerLike["log"]>(),
    trace: vi.fn<LoggerLike["trace"]>(),
    debug: vi.fn<LoggerLike["debug"]>(),
    info: vi.fn<LoggerLike["info"]>(),
    warn: vi.fn<LoggerLike["warn"]>(),
    error: vi.fn<LoggerLike["error"]>(),
    fatal: vi.fn<LoggerLike["fatal"]>(),
    captureException: vi.fn<LoggerLike["captureException"]>(),
    ready: vi.fn<LoggerLike["ready"]>(async () => {}),
    flush: vi.fn<LoggerLike["flush"]>(async () => {}),
    close: vi.fn<LoggerLike["close"]>(async () => {}),
    ...overrides,
    event: overrides.event ?? (() => {}),
  };
}

function createIntegrationContext(logger: LoggerLike): {
  context: IntegrationSetupContext;
  capture: ReturnType<typeof vi.fn<(input: CaptureInput) => void>>;
} {
  const capture = vi.fn<(input: CaptureInput) => void>();
  const context = createIntegrationSetupContext({
    name: "capture-process",
    logger,
    capture,
    getLogger: () => logger,
  });
  return { context, capture };
}

function lastListener<T extends (...args: never[]) => void>(event: string): T {
  const listeners = nodeProcess.listeners(event);
  const listener = listeners[listeners.length - 1];
  if (!listener) throw new Error(`Missing ${event} listener`);
  return listener as unknown as T;
}

describe("captureProcessIntegration", () => {
  const teardowns: Array<() => void> = [];
  const tempDirs: string[] = [];

  afterEach(() => {
    while (teardowns.length > 0) {
      teardowns.pop()?.();
    }
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("removes process listeners on teardown", () => {
    const before = nodeProcess.listenerCount("warning");
    const teardown = captureProcessIntegration({
      uncaughtException: false,
      unhandledRejection: false,
      warning: true,
      beforeExitFlush: false,
    }).setup(createIntegrationContext(createLogger()).context);

    expect(typeof teardown).toBe("function");
    if (typeof teardown === "function") teardowns.push(teardown);

    expect(nodeProcess.listenerCount("warning")).toBe(before + 1);

    teardowns.pop()?.();

    expect(nodeProcess.listenerCount("warning")).toBe(before);
  });

  it("captures uncaught exceptions, flushes, and exits by default", async () => {
    const flush = vi.fn<LoggerLike["flush"]>(async () => {});
    const flushSync = vi.fn<NonNullable<LoggerLike["flushSync"]>>();
    const logger = createLogger({ flush, flushSync });
    const { context, capture } = createIntegrationContext(logger);
    const exitFn = vi.fn<(code: number) => void>();
    const teardown = captureProcessIntegration({
      unhandledRejection: false,
      warning: false,
      beforeExitFlush: false,
      exitFlush: false,
      exitFn,
    }).setup(context);
    if (typeof teardown === "function") teardowns.push(teardown);
    const error = new Error("crashed");

    lastListener<(error: Error) => void>("uncaughtException")(error);
    await Promise.resolve();
    await Promise.resolve();

    expect(capture).toHaveBeenCalledWith({
      level: "fatal",
      message: "crashed",
      error,
      props: { process: { kind: "uncaughtException" } },
      source: "integration:capture-process",
    });
    expect(flushSync).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(exitFn).toHaveBeenCalledWith(1);
    });
  });

  it("flushes on beforeExit and sync flushes on exit", () => {
    const flush = vi.fn<LoggerLike["flush"]>(async () => {});
    const flushSync = vi.fn<NonNullable<LoggerLike["flushSync"]>>();
    const logger = createLogger({ flush, flushSync });
    const { context } = createIntegrationContext(logger);
    const teardown = captureProcessIntegration({
      uncaughtException: false,
      unhandledRejection: false,
      warning: false,
      beforeExitFlush: true,
      exitFlush: true,
    }).setup(context);
    if (typeof teardown === "function") teardowns.push(teardown);

    lastListener<() => void>("beforeExit")();
    lastListener<() => void>("exit")();

    expect(flush).toHaveBeenCalledTimes(1);
    expect(flushSync).toHaveBeenCalledTimes(1);
  });

  it("captures configured process signals, flushes, and preserves signal exit code", async () => {
    const flush = vi.fn<LoggerLike["flush"]>(async () => {});
    const flushSync = vi.fn<NonNullable<LoggerLike["flushSync"]>>();
    const logger = createLogger({ flush, flushSync });
    const { context, capture } = createIntegrationContext(logger);
    const exitFn = vi.fn<(code: number) => void>();
    const teardown = captureProcessIntegration({
      beforeExitFlush: false,
      exitFlush: false,
      signalFlush: true,
      signals: ["SIGTERM"],
      uncaughtException: false,
      unhandledRejection: false,
      warning: false,
      exitFn,
    }).setup(context);
    if (typeof teardown === "function") teardowns.push(teardown);

    lastListener<() => void>("SIGTERM")();
    await Promise.resolve();
    await Promise.resolve();

    expect(capture).toHaveBeenCalledWith({
      level: "fatal",
      message: "Process signal SIGTERM",
      props: { process: { kind: "signal", signal: "SIGTERM" } },
      source: "integration:capture-process",
    });
    expect(flushSync).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(exitFn).toHaveBeenCalledWith(143);
    });
  });

  it("captures warnings and unhandled rejections through IntegrationAPI", () => {
    const logger = createLogger();
    const { context, capture } = createIntegrationContext(logger);
    const teardown = captureProcessIntegration({
      uncaughtException: false,
      beforeExitFlush: false,
      exitFlush: false,
      exitOnUncaught: false,
    }).setup(context);
    if (typeof teardown === "function") teardowns.push(teardown);
    const warning = Object.assign(new Error("deprecated"), {
      name: "DeprecationWarning",
      code: "DEP_TEST",
    });
    const rejection = new Error("rejected");

    lastListener<(warning: Error) => void>("warning")(warning);
    lastListener<(reason: unknown) => void>("unhandledRejection")(rejection);

    expect(capture).toHaveBeenCalledWith({
      level: "warn",
      message: "deprecated",
      error: warning,
      props: {
        process: {
          kind: "warning",
          name: "DeprecationWarning",
          code: "DEP_TEST",
        },
      },
      source: "integration:capture-process",
    });
    expect(capture).toHaveBeenCalledWith({
      level: "error",
      message: "rejected",
      error: rejection,
      props: {
        process: { kind: "unhandledRejection" },
        reason: expect.objectContaining({
          name: "Error",
          message: "rejected",
        }),
      },
      source: "integration:capture-process",
    });
  });

  it("persists a fatal uncaught exception before process exit", () => {
    const dir = mkdtempSync(join(tmpdir(), "loggerjs-crash-"));
    tempDirs.push(dir);
    const outputPath = join(dir, "logs", "fatal.ndjson");

    const result = spawnSync(tsxBin, [crashFixture, outputPath], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 15_000,
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    const output = readFileSync(outputPath, "utf8");
    expect(output).toContain("fixture fatal crash");
    expect(output).toContain("uncaughtException");
  });
});
