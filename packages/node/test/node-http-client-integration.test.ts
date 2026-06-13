import { describe, expect, it, vi } from "vitest";
import {
  createIntegrationSetupContext,
  type CaptureInput,
  type IntegrationSetupContext,
  type LoggerLike,
} from "@loggerjs/core";
import { nodeHttpClientIntegration, type NodeHttpModuleLike } from "../src";

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

function createIntegrationContext(): {
  context: IntegrationSetupContext;
  capture: ReturnType<typeof vi.fn<(input: CaptureInput) => void>>;
} {
  const logger = createLogger();
  const capture = vi.fn<(input: CaptureInput) => void>();
  const context = createIntegrationSetupContext({
    name: "node-http-client",
    logger,
    capture,
    getLogger: () => logger,
  });
  return { context, capture };
}

class FakeClientRequest {
  ended = false;
  private listeners = new Map<
    "response" | "error",
    Array<{ listener: (...args: unknown[]) => void; once: boolean }>
  >();

  once(event: "response" | "error", listener: (...args: unknown[]) => void) {
    this.add(event, listener, true);
  }

  on(event: "response" | "error", listener: (...args: unknown[]) => void) {
    this.add(event, listener, false);
  }

  off(event: "response" | "error", listener: (...args: unknown[]) => void) {
    this.removeListener(event, listener);
  }

  removeListener(event: "response" | "error", listener: (...args: unknown[]) => void) {
    const entries = this.listeners.get(event) ?? [];
    this.listeners.set(
      event,
      entries.filter((entry) => entry.listener !== listener),
    );
  }

  emit(event: "response" | "error", ...args: unknown[]) {
    const entries = this.listeners.get(event) ?? [];
    for (const entry of entries) {
      if (entry.once) this.removeListener(event, entry.listener);
      entry.listener(...args);
    }
  }

  end() {
    this.ended = true;
    return this;
  }

  private add(event: "response" | "error", listener: (...args: unknown[]) => void, once: boolean) {
    const entries = this.listeners.get(event) ?? [];
    entries.push({ listener, once });
    this.listeners.set(event, entries);
  }
}

function fakeHttpModule(): NodeHttpModuleLike & {
  requests: FakeClientRequest[];
  originalRequest: NonNullable<NodeHttpModuleLike["request"]>;
  originalGet: NonNullable<NodeHttpModuleLike["get"]>;
} {
  const requests: FakeClientRequest[] = [];
  const originalRequest: NonNullable<NodeHttpModuleLike["request"]> = function originalRequest(
    _url: unknown,
    _options?: unknown,
  ) {
    const request = new FakeClientRequest();
    requests.push(request);
    return request;
  };
  const originalGet: NonNullable<NodeHttpModuleLike["get"]> = function originalGet(
    this: unknown,
    ...args: unknown[]
  ) {
    const request = originalRequest.apply(this, args);
    request.end?.();
    return request;
  };
  return {
    requests,
    originalRequest,
    originalGet,
    request: originalRequest,
    get: originalGet,
  };
}

describe("nodeHttpClientIntegration", () => {
  it("captures failed responses with sanitized url and whitelisted headers", () => {
    const httpModule = fakeHttpModule();
    const { context, capture } = createIntegrationContext();
    const teardown = nodeHttpClientIntegration({
      httpModule,
      httpsModule: null,
      captureRequestHeaders: ["x-request-id", "authorization"],
      captureResponseHeaders: ["x-trace-id"],
      sanitizeUrl: (url) => url.replace(/token=[^&]+/, "token=[redacted]"),
    }).setup(context);

    const request = httpModule.request?.("http://api.example/users?token=secret", {
      headers: {
        authorization: "secret",
        "x-request-id": "r1",
      },
      method: "post",
    }) as FakeClientRequest;
    request.emit("response", {
      headers: {
        "set-cookie": "private",
        "x-trace-id": "trace-1",
      },
      statusCode: 503,
    });

    expect(capture).toHaveBeenCalledWith({
      level: "error",
      message: "HTTP 503 POST http://api.example/users?token=[redacted]",
      error: undefined,
      props: {
        http: {
          kind: "node-http-client",
          runtime: "node",
          direction: "outgoing",
          protocol: "http:",
          method: "POST",
          url: "http://api.example/users?token=[redacted]",
          status: 503,
          requestHeaders: {
            authorization: "secret",
            "x-request-id": "r1",
          },
          responseHeaders: {
            "x-trace-id": "trace-1",
          },
        },
      },
      source: "integration:node-http-client",
    });

    if (typeof teardown === "function") teardown();
  });

  it("captures client errors and restores patched methods", () => {
    const httpModule = fakeHttpModule();
    const originalRequest = httpModule.request;
    const originalGet = httpModule.get;
    const { context, capture } = createIntegrationContext();
    const teardown = nodeHttpClientIntegration({
      httpModule,
      httpsModule: null,
    }).setup(context);
    const error = Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" });

    const request = httpModule.request?.({ hostname: "api.example", path: "/boom" }) as
      | FakeClientRequest
      | undefined;
    request?.emit("error", error);

    expect(capture).toHaveBeenCalledWith({
      level: "error",
      message: "HTTP error GET http://api.example/boom",
      error,
      props: {
        http: {
          kind: "node-http-client",
          runtime: "node",
          direction: "outgoing",
          protocol: "http:",
          method: "GET",
          url: "http://api.example/boom",
          status: undefined,
          requestHeaders: undefined,
          responseHeaders: undefined,
        },
      },
      source: "integration:node-http-client",
    });

    if (typeof teardown === "function") teardown();
    expect(httpModule.request).toBe(originalRequest);
    expect(httpModule.get).toBe(originalGet);
  });

  it("patches get through request and samples successful responses", () => {
    const httpModule = fakeHttpModule();
    const { context, capture } = createIntegrationContext();
    const teardown = nodeHttpClientIntegration({
      httpModule,
      httpsModule: null,
      captureAll: true,
      sampleRate: 1,
    }).setup(context);

    const request = httpModule.get?.("http://api.example/ok") as FakeClientRequest;
    request.emit("response", { headers: {}, statusCode: 200 });

    expect(request.ended).toBe(true);
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "info",
        message: "HTTP 200 GET http://api.example/ok",
      }),
    );

    if (typeof teardown === "function") teardown();
  });
});
