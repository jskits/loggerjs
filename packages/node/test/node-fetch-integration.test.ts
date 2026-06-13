import { describe, expect, it, vi } from "vitest";
import {
  createIntegrationSetupContext,
  type CaptureInput,
  type IntegrationSetupContext,
  type LoggerLike,
} from "@loggerjs/core";
import { nodeFetchIntegration, type NodeFetchFunction, type NodeFetchTargetLike } from "../src";

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
    name: "node-fetch",
    logger,
    capture,
    getLogger: () => logger,
  });
  return { context, capture };
}

function headers(values: Record<string, string>) {
  return {
    get(name: string) {
      return values[name.toLowerCase()] ?? null;
    },
  };
}

describe("nodeFetchIntegration", () => {
  it("captures failed fetch responses with whitelisted headers", async () => {
    const fetch = vi.fn<NodeFetchFunction>(async () => ({
      headers: headers({ "x-trace-id": "trace-1" }),
      status: 503,
    }));
    const target: NodeFetchTargetLike = { fetch };
    const { context, capture } = createIntegrationContext();
    const teardown = nodeFetchIntegration({
      target,
      captureRequestHeaders: ["x-request-id", "authorization"],
      captureResponseHeaders: ["x-trace-id"],
      sanitizeUrl: (url) => url.replace(/token=[^&]+/, "token=[redacted]"),
    }).setup(context);

    await target.fetch?.("https://api.example/users?token=secret", {
      headers: {
        authorization: "secret",
        "x-request-id": "r1",
      },
      method: "post",
    });

    expect(capture).toHaveBeenCalledWith({
      level: "error",
      message: "Fetch 503 POST https://api.example/users?token=[redacted]",
      error: undefined,
      props: {
        http: {
          kind: "node-fetch",
          runtime: "node",
          instrument: "fetch",
          direction: "outgoing",
          method: "POST",
          url: "https://api.example/users?token=[redacted]",
          status: 503,
          durationMs: expect.any(Number),
          requestHeaders: {
            authorization: "secret",
            "x-request-id": "r1",
          },
          responseHeaders: {
            "x-trace-id": "trace-1",
          },
        },
      },
      source: "integration:node-fetch",
    });

    if (typeof teardown === "function") teardown();
  });

  it("captures rejected fetches, rethrows, and restores the original fetch", async () => {
    const error = new Error("network down");
    const fetch = vi.fn<NodeFetchFunction>(async () => {
      throw error;
    });
    const target: NodeFetchTargetLike = { fetch };
    const { context, capture } = createIntegrationContext();
    const teardown = nodeFetchIntegration({ target }).setup(context);

    await expect(target.fetch?.("https://api.example/down")).rejects.toThrow("network down");

    expect(capture).toHaveBeenCalledWith({
      level: "error",
      message: "Fetch error GET https://api.example/down",
      error,
      props: {
        http: {
          kind: "node-fetch",
          runtime: "node",
          instrument: "fetch",
          direction: "outgoing",
          method: "GET",
          url: "https://api.example/down",
          status: undefined,
          durationMs: expect.any(Number),
          requestHeaders: undefined,
          responseHeaders: undefined,
        },
      },
      source: "integration:node-fetch",
    });

    if (typeof teardown === "function") teardown();
    expect(target.fetch).toBe(fetch);
  });

  it("skips successful responses by default unless captureAll is enabled", async () => {
    const target: NodeFetchTargetLike = {
      fetch: vi.fn<NodeFetchFunction>(async () => ({ headers: {}, status: 200 })),
    };
    const { context, capture } = createIntegrationContext();
    const teardown = nodeFetchIntegration({ target }).setup(context);

    await target.fetch?.("https://api.example/ok");

    expect(capture).not.toHaveBeenCalled();
    if (typeof teardown === "function") teardown();

    const captureAll = createIntegrationContext();
    const teardownAll = nodeFetchIntegration({ captureAll: true, target }).setup(
      captureAll.context,
    );
    await target.fetch?.("https://api.example/ok");

    expect(captureAll.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "info",
        message: "Fetch 200 GET https://api.example/ok",
      }),
    );
    if (typeof teardownAll === "function") teardownAll();
  });
});
