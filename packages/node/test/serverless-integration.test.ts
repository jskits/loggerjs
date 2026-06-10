import { describe, expect, it, vi } from "vitest";
import { type LoggerLike } from "@loggerjs/core";
import { serverlessIntegration } from "../src";

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

describe("serverlessIntegration", () => {
  it("captures successful async invocations with request metadata", async () => {
    const logger = createLogger();
    const handler = serverlessIntegration(logger, async () => ({ statusCode: 204 }), {
      captureResult: true,
      name: "lambda",
      platform: "aws-lambda",
    });

    await handler(
      {
        requestContext: {
          http: { method: "GET", path: "/users" },
          requestId: "req-1",
        },
      },
      {
        awsRequestId: "aws-1",
        functionName: "get-users",
      },
    );

    expect(logger.log).toHaveBeenCalledWith("info", "Serverless GET /users", {
      error: undefined,
      serverless: {
        kind: "lambda",
        platform: "aws-lambda",
        operation: "GET /users",
        requestId: "aws-1",
        coldStart: expect.any(Boolean),
        durationMs: expect.any(Number),
        event: undefined,
        result: {
          statusCode: 204,
        },
      },
    });
  });

  it("captures thrown errors and rethrows them", async () => {
    const logger = createLogger();
    const error = new Error("failed");
    const handler = serverlessIntegration(
      logger,
      async () => {
        throw error;
      },
      {
        captureEvent: true,
        getRequestId: () => "req-2",
        getOperation: () => "job",
      },
    );

    await expect(handler({ type: "daily" }, { functionName: "job" })).rejects.toThrow("failed");

    expect(logger.log).toHaveBeenCalledWith("error", "Serverless job", {
      error,
      serverless: {
        kind: "serverless",
        platform: "serverless",
        operation: "job",
        requestId: "req-2",
        coldStart: expect.any(Boolean),
        durationMs: expect.any(Number),
        event: {
          type: "daily",
        },
        result: undefined,
      },
    });
  });

  it("captures callback-style handlers", () => {
    const logger = createLogger();
    const callback = vi.fn<(error?: unknown, result?: string) => void>();
    const handler = serverlessIntegration<unknown, unknown, string>(
      logger,
      (_event, _context, done) => {
        done?.(undefined, "ok");
      },
      {
        captureResult: true,
        getOperation: () => "callback",
      },
    );

    handler({}, {}, callback);

    expect(callback).toHaveBeenCalledWith(undefined, "ok");
    expect(logger.log).toHaveBeenCalledWith(
      "info",
      "Serverless callback",
      expect.objectContaining({
        serverless: expect.objectContaining({
          result: "ok",
        }),
      }),
    );
  });
});
