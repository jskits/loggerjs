import { describe, expect, it, vi } from "vitest";
import type { LoggerLike } from "@loggerjs/core";
import {
  fastifyIntegration,
  type FastifyDone,
  type FastifyInstanceLike,
  type FastifyOnErrorHook,
  type FastifyOnRequestHook,
  type FastifyOnResponseHook,
  type FastifyReplyLike,
  type FastifyRequestLike,
} from "../src";

class FakeFastify implements FastifyInstanceLike {
  onRequest?: FastifyOnRequestHook;
  onResponse?: FastifyOnResponseHook;
  onError?: FastifyOnErrorHook;

  addHook(name: "onRequest" | "onResponse" | "onError", hook: unknown) {
    if (name === "onRequest") this.onRequest = hook as FastifyOnRequestHook;
    if (name === "onResponse") this.onResponse = hook as FastifyOnResponseHook;
    if (name === "onError") this.onError = hook as FastifyOnErrorHook;
  }
}

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

function request(patch: Partial<FastifyRequestLike> = {}): FastifyRequestLike {
  return {
    id: "req-1",
    method: "GET",
    url: "/orders?token=secret",
    headers: { "x-request-id": "req-1" },
    ip: "127.0.0.1",
    routeOptions: { url: "/orders" },
    ...patch,
  };
}

function reply(patch: Partial<FastifyReplyLike> = {}): FastifyReplyLike {
  const headers = new Map<string, string | string[]>();
  headers.set("x-response-id", "res-1");
  return {
    statusCode: 200,
    getHeader: (name) => headers.get(name.toLowerCase()),
    ...patch,
  };
}

function install(logger: LoggerLike, options: Parameters<typeof fastifyIntegration>[1] = {}) {
  const app = new FakeFastify();
  const done = vi.fn<FastifyDone>();
  fastifyIntegration(logger, options)(app, {}, done);
  expect(done).toHaveBeenCalledTimes(1);
  if (!app.onRequest || !app.onResponse || !app.onError) {
    throw new Error("Fastify hooks were not registered");
  }
  return app;
}

describe("fastifyIntegration", () => {
  it("logs failed responses with sanitized URL and selected headers", () => {
    const logger = createLogger();
    const app = install(logger, {
      captureRequestHeaders: ["x-request-id"],
      captureResponseHeaders: ["x-response-id"],
    });
    const req = request();
    const res = reply({ statusCode: 503 });

    app.onRequest?.(req, res, () => {});
    app.onResponse?.(req, res, () => {});

    expect(logger.log).toHaveBeenCalledWith("error", "Fastify 503 GET /orders", {
      http: expect.objectContaining({
        framework: "fastify",
        method: "GET",
        url: "/orders",
        route: "/orders",
        status: 503,
        requestId: "req-1",
        requestHeaders: { "x-request-id": "req-1" },
        responseHeaders: { "x-response-id": "res-1" },
      }),
    });
  });

  it("does not log successful responses by default", () => {
    const logger = createLogger();
    const app = install(logger);
    const req = request();
    const res = reply({ statusCode: 200 });

    app.onRequest?.(req, res, () => {});
    app.onResponse?.(req, res, () => {});

    expect(logger.log).not.toHaveBeenCalled();
  });

  it("captures sampled successful responses when enabled", () => {
    const logger = createLogger();
    const app = install(logger, { captureAll: true, sampleRate: 1 });
    const req = request({ method: "post", url: "/checkout#payment" });
    const res = reply({ statusCode: 201 });

    app.onRequest?.(req, res, () => {});
    app.onResponse?.(req, res, () => {});

    expect(logger.log).toHaveBeenCalledWith("info", "Fastify 201 POST /checkout", {
      http: expect.objectContaining({
        method: "POST",
        url: "/checkout",
        status: 201,
      }),
    });
  });

  it("captures onError state even before a failed response is sent", () => {
    const logger = createLogger();
    const app = install(logger);
    const req = request();
    const res = reply({ statusCode: 200 });
    const error = new Error("handler failed");

    app.onRequest?.(req, res, () => {});
    app.onError?.(req, res, error, () => {});
    app.onResponse?.(req, res, () => {});

    expect(logger.log).toHaveBeenCalledWith("error", "Fastify 200 GET /orders", {
      http: expect.objectContaining({
        status: 200,
      }),
      error,
    });
  });
});
