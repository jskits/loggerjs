import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createIntegrationSetupContext,
  type CaptureInput,
  type IntegrationSetupContext,
  type LoggerLike,
} from "@loggerjs/core";
import { captureFetchIntegration, captureXHRIntegration } from "../src";

type XHRListener = EventListenerOrEventListenerObject;

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

function createIntegrationContext(name: string): {
  context: IntegrationSetupContext;
  capture: ReturnType<typeof vi.fn<(input: CaptureInput) => void>>;
  logger: LoggerLike;
} {
  const logger = createLogger();
  const capture = vi.fn<(input: CaptureInput) => void>();
  const context = createIntegrationSetupContext({
    name,
    logger,
    capture,
    getLogger: () => logger,
  });
  return { context, capture, logger };
}

class FakeXMLHttpRequest {
  static instances: FakeXMLHttpRequest[] = [];

  status = 0;
  readonly listeners = new Map<string, XHRListener[]>();

  constructor() {
    FakeXMLHttpRequest.instances.push(this);
  }

  open(_method: string, _url: string | URL): void {}

  send(_body?: Document | XMLHttpRequestBodyInit | null): void {}

  addEventListener(type: string, listener: XHRListener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: string): void {
    const event = new Event(type);
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === "function") listener.call(this, event);
      else listener.handleEvent(event);
    }
  }
}

describe("HTTP capture integrations", () => {
  afterEach(() => {
    FakeXMLHttpRequest.instances = [];
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("captures failed fetch responses with sanitized URLs and allowlisted headers", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => {
      return new Response(null, {
        status: 500,
        headers: {
          "x-response-id": "res-1",
          "set-cookie": "secret",
        },
      });
    });
    vi.stubGlobal("fetch", fetchFn);
    const { context, capture, logger } = createIntegrationContext("capture-fetch");
    context.unpatched.fetch = fetchFn;

    captureFetchIntegration({
      captureRequestHeaders: ["x-request-id"],
      captureResponseHeaders: ["x-response-id"],
    }).setup(context);

    await fetch("/api/orders?token=secret#details", {
      method: "POST",
      headers: {
        authorization: "secret",
        "x-request-id": "req-1",
      },
    });

    expect(capture).toHaveBeenCalledWith({
      level: "warn",
      message: "Fetch 500 POST /api/orders",
      props: {
        http: {
          kind: "fetch",
          method: "POST",
          url: "/api/orders",
          status: 500,
          ok: false,
          durationMs: expect.any(Number),
          requestHeaders: { "x-request-id": "req-1" },
          responseHeaders: { "x-response-id": "res-1" },
        },
      },
      source: "integration:capture-fetch",
    });
    expect(logger.log).not.toHaveBeenCalled();
  });

  it("does not capture successful fetches by default but captures network errors", async () => {
    const networkError = new Error("offline");
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockRejectedValueOnce(networkError);
    vi.stubGlobal("fetch", fetchFn);
    const { context, capture } = createIntegrationContext("capture-fetch");
    context.unpatched.fetch = fetchFn;

    captureFetchIntegration().setup(context);

    await fetch("/health?token=secret");
    await expect(fetch("/health?token=secret")).rejects.toThrow("offline");

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith({
      level: "error",
      message: "Fetch network error GET /health",
      error: networkError,
      props: {
        http: {
          kind: "fetch",
          method: "GET",
          url: "/health",
          durationMs: expect.any(Number),
        },
        input: "/health?token=secret",
      },
      source: "integration:capture-fetch",
    });
  });

  it("captures XHR status failures with sanitized URLs", () => {
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest as unknown as typeof XMLHttpRequest);
    const { context, capture } = createIntegrationContext("capture-xhr");
    context.unpatched.XMLHttpRequest = FakeXMLHttpRequest as unknown as typeof XMLHttpRequest;

    captureXHRIntegration().setup(context);

    const xhr = new XMLHttpRequest() as unknown as FakeXMLHttpRequest;
    xhr.open("GET", "/api/users?token=secret");
    xhr.send();
    xhr.status = 404;
    xhr.emit("loadend");

    expect(capture).toHaveBeenCalledWith({
      level: "warn",
      message: "XHR 404 GET /api/users",
      props: {
        http: {
          kind: "xhr",
          method: "GET",
          url: "/api/users",
          status: 404,
          durationMs: expect.any(Number),
        },
      },
      source: "integration:capture-xhr",
    });
  });

  it("captures XHR network errors once", () => {
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest as unknown as typeof XMLHttpRequest);
    const { context, capture } = createIntegrationContext("capture-xhr");
    context.unpatched.XMLHttpRequest = FakeXMLHttpRequest as unknown as typeof XMLHttpRequest;

    captureXHRIntegration().setup(context);

    const xhr = new XMLHttpRequest() as unknown as FakeXMLHttpRequest;
    xhr.open("POST", "https://api.example.test/submit?token=secret");
    xhr.send();
    xhr.emit("error");
    xhr.emit("loadend");

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith({
      level: "error",
      message: "XHR network error POST https://api.example.test/submit",
      props: {
        http: {
          kind: "xhr",
          method: "POST",
          url: "https://api.example.test/submit",
          durationMs: expect.any(Number),
        },
      },
      source: "integration:capture-xhr",
    });
  });
});
