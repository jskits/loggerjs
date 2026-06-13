import { describe, expect, it, vi } from "vitest";
import type { LoggerLike } from "@loggerjs/core";
import {
  expressIntegration,
  type ExpressNextFunction,
  type ExpressRequestLike,
  type ExpressResponseLike,
} from "../src";

class FakeResponse implements ExpressResponseLike {
  statusCode = 200;
  writableEnded = false;
  private readonly listeners = new Map<string, Array<() => void>>();
  private readonly headers = new Map<string, string | string[]>();

  once(event: "finish" | "close", listener: () => void) {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  off(event: "finish" | "close", listener: () => void) {
    const listeners = this.listeners.get(event) ?? [];
    this.listeners.set(
      event,
      listeners.filter((item) => item !== listener),
    );
  }

  getHeader(name: string) {
    return this.headers.get(name.toLowerCase());
  }

  setHeader(name: string, value: string | string[]) {
    this.headers.set(name.toLowerCase(), value);
  }

  emit(event: "finish" | "close") {
    if (event === "finish") this.writableEnded = true;
    for (const listener of this.listeners.get(event) ?? []) listener();
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
    ready: vi.fn<LoggerLike["ready"]>(async () => {}),
    flush: vi.fn<LoggerLike["flush"]>(async () => {}),
    close: vi.fn<LoggerLike["close"]>(async () => {}),
  };
}

function request(patch: Partial<ExpressRequestLike> = {}): ExpressRequestLike {
  return {
    method: "GET",
    originalUrl: "/orders?token=secret",
    headers: { "x-request-id": "req-1" },
    ip: "127.0.0.1",
    route: { path: "/orders" },
    ...patch,
  };
}

describe("expressIntegration", () => {
  it("logs failed responses with sanitized URL and selected headers", () => {
    const logger = createLogger();
    const res = new FakeResponse();
    res.statusCode = 503;
    res.setHeader("x-response-id", "res-1");
    const next = vi.fn<ExpressNextFunction>();

    expressIntegration(logger, {
      captureRequestHeaders: ["x-request-id"],
      captureResponseHeaders: ["x-response-id"],
      getRequestId: (req) => String(req.headers?.["x-request-id"]),
    })(request(), res, next);
    res.emit("finish");

    expect(next).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith("error", "Express 503 GET /orders", {
      http: expect.objectContaining({
        framework: "express",
        method: "GET",
        url: "/orders",
        route: "/orders",
        status: 503,
        aborted: false,
        requestId: "req-1",
        requestHeaders: { "x-request-id": "req-1" },
        responseHeaders: { "x-response-id": "res-1" },
      }),
    });
  });

  it("does not log successful responses by default", () => {
    const logger = createLogger();
    const res = new FakeResponse();

    expressIntegration(logger)(request(), res, () => {});
    res.emit("finish");

    expect(logger.log).not.toHaveBeenCalled();
  });

  it("captures sampled successful responses when enabled", () => {
    const logger = createLogger();
    const res = new FakeResponse();

    expressIntegration(logger, {
      captureAll: true,
      sampleRate: 1,
    })(request({ method: "post", originalUrl: "/checkout#payment" }), res, () => {});
    res.emit("finish");

    expect(logger.log).toHaveBeenCalledWith("info", "Express 200 POST /checkout", {
      http: expect.objectContaining({
        method: "POST",
        url: "/checkout",
        status: 200,
      }),
    });
  });

  it("captures aborted responses on close", () => {
    const logger = createLogger();
    const res = new FakeResponse();

    expressIntegration(logger)(request(), res, () => {});
    res.emit("close");

    expect(logger.log).toHaveBeenCalledWith("warn", "Express 200 GET /orders", {
      http: expect.objectContaining({
        status: 200,
        aborted: true,
      }),
    });
  });
});
