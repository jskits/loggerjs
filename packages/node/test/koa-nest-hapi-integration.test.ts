import { describe, expect, it, vi } from "vitest";
import type { LoggerLike } from "@loggerjs/core";
import {
  hapiIntegration,
  koaIntegration,
  nestMiddlewareIntegration,
  type HapiRequestLike,
  type HapiToolkitLike,
} from "../src";

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
    ready: vi.fn<LoggerLike["ready"]>(async () => {}),
    flush: vi.fn<LoggerLike["flush"]>(async () => {}),
    close: vi.fn<LoggerLike["close"]>(async () => {}),
  };
}

describe("Node framework adapters", () => {
  it("logs Koa request lifecycle", async () => {
    const logger = createLogger();
    const middleware = koaIntegration(logger, { captureAll: true });

    await middleware({ method: "get", url: "/orders?token=secret", status: 201 }, async () => {});

    expect(logger.log).toHaveBeenCalledWith("info", "Koa 201 GET /orders", {
      http: expect.objectContaining({
        framework: "koa",
        method: "GET",
        status: 201,
        url: "/orders",
      }),
      error: undefined,
    });
  });

  it("creates a Nest middleware using Express-compatible semantics", () => {
    const logger = createLogger();
    const middleware = nestMiddlewareIntegration(logger, { captureAll: true });
    const res = {
      statusCode: 200,
      once(_event: "finish" | "close", listener: () => void) {
        listener();
      },
    };

    middleware({ method: "GET", originalUrl: "/nest" }, res, () => {});

    expect(logger.log).toHaveBeenCalledWith("info", "Express 200 GET /nest", {
      http: expect.objectContaining({ framework: "express", kind: "nestjs" }),
    });
  });

  it("registers Hapi request and response hooks", () => {
    const logger = createLogger();
    type OnRequest = (request: HapiRequestLike, h: HapiToolkitLike) => unknown;
    type OnResponse = (request: HapiRequestLike) => void;
    let onRequest: OnRequest | undefined;
    let onResponse: OnResponse | undefined;
    const server = {
      ext: vi.fn<(event: "onRequest", handler: OnRequest) => void>((_event, handler) => {
        onRequest = handler;
      }),
      events: {
        on: vi.fn<(event: "response", handler: OnResponse) => void>((_event, handler) => {
          onResponse = handler;
        }),
      },
    };

    hapiIntegration(logger, { captureAll: true }).register(server);
    const request = {
      method: "post",
      path: "/hapi",
      info: { id: "req-1", remoteAddress: "127.0.0.1" },
      response: { statusCode: 503 },
    };
    onRequest?.(request, { continue: Symbol.for("continue") });
    onResponse?.(request);

    expect(logger.log).toHaveBeenCalledWith("error", "Hapi 503 POST /hapi", {
      http: expect.objectContaining({
        framework: "hapi",
        method: "POST",
        requestId: "req-1",
        status: 503,
      }),
    });
  });
});
