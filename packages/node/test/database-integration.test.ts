import { describe, expect, it, vi } from "vitest";
import {
  createIntegrationSetupContext,
  type CaptureInput,
  type IntegrationSetupContext,
  type LoggerLike,
} from "@loggerjs/core";
import { databaseIntegration, type DatabaseClientLike } from "../src";

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
    name: "database",
    logger,
    capture,
    getLogger: () => logger,
  });
  return { context, capture };
}

describe("databaseIntegration", () => {
  it("captures async database operations when captureAll is enabled", async () => {
    const client: DatabaseClientLike = {
      query: vi.fn<(statement: string, parameters: unknown[]) => Promise<unknown>>(async () => ({
        rows: [{ id: 1 }],
      })),
    };
    const { context, capture } = createIntegrationContext();
    const teardown = databaseIntegration({
      captureAll: true,
      client,
      system: "postgresql",
      captureParameters: false,
      sanitizeStatement: (statement) => statement.replace(/token = '[^']+'/, "token = ?"),
    }).setup(context);

    await (client.query as (statement: string, parameters: unknown[]) => Promise<unknown>)(
      "select * from users where token = 'secret'",
      ["secret"],
    );

    expect(capture).toHaveBeenCalledWith({
      level: "debug",
      message: "Database query select * from users where token = ?",
      error: undefined,
      props: {
        db: {
          kind: "database",
          system: "postgresql",
          method: "query",
          statement: "select * from users where token = ?",
          durationMs: expect.any(Number),
          parameters: undefined,
        },
      },
      source: "integration:database",
    });

    if (typeof teardown === "function") teardown();
  });

  it("captures sync database errors and restores wrapped methods", () => {
    const error = new Error("constraint failed");
    const originalRun = vi.fn<(statement: string, parameters: unknown[]) => void>(() => {
      throw error;
    });
    const client: DatabaseClientLike = {
      run: originalRun,
    };
    const { context, capture } = createIntegrationContext();
    const teardown = databaseIntegration({
      captureParameters: true,
      client,
      name: "sqlite-writer",
      system: "sqlite",
    }).setup(context);

    expect(() =>
      (client.run as (statement: string, parameters: unknown[]) => void)(
        "insert into audit values (?)",
        ["secret"],
      ),
    ).toThrow("constraint failed");

    expect(capture).toHaveBeenCalledWith({
      level: "error",
      message: "Database error run insert into audit values (?)",
      error,
      props: {
        db: {
          kind: "sqlite-writer",
          system: "sqlite",
          method: "run",
          statement: "insert into audit values (?)",
          durationMs: expect.any(Number),
          parameters: ["secret"],
        },
      },
      source: "integration:database",
    });

    if (typeof teardown === "function") teardown();
    expect(client.run).toBe(originalRun);
  });

  it("captures slow operations without captureAll", async () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValueOnce(100).mockReturnValueOnce(145);
    const client: DatabaseClientLike = {
      execute: vi.fn<(statement: string) => Promise<unknown>>(async () => "ok"),
    };
    const { context, capture } = createIntegrationContext();
    const teardown = databaseIntegration({
      client,
      minDurationMs: 40,
    }).setup(context);

    await (client.execute as (statement: string) => Promise<unknown>)("select 1");

    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "debug",
        message: "Database execute select 1",
      }),
    );

    if (typeof teardown === "function") teardown();
    now.mockRestore();
  });
});
