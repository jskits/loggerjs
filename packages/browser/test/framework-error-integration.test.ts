import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createIntegrationSetupContext,
  type CaptureInput,
  type IntegrationSetupContext,
  type LoggerLike,
} from "@loggerjs/core";
import { captureFrameworkErrorsIntegration } from "../src";

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
    name: "capture-framework-errors",
    logger,
    capture,
    getLogger: () => logger,
  });
  return { context, capture };
}

describe("captureFrameworkErrorsIntegration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("queues framework errors before setup and flushes them on setup", () => {
    const integration = captureFrameworkErrorsIntegration({
      framework: "react",
      getMessage: (error) => `Boundary: ${error instanceof Error ? error.message : "error"}`,
    });
    const error = new Error("render failed");
    integration.capture(error, {
      componentName: "Checkout",
      componentStack: "\n  at Checkout",
      props: { orderId: "ord-1" },
    });

    const { context, capture } = createIntegrationContext();
    integration.setup(context);

    expect(capture).toHaveBeenCalledWith({
      level: "error",
      message: "Boundary: render failed",
      error,
      props: {
        browser: {
          kind: "framework-error",
          framework: "react",
          componentName: "Checkout",
          componentStack: "\n  at Checkout",
          info: undefined,
          props: { orderId: "ord-1" },
        },
      },
      source: "integration:capture-framework-errors",
    });
  });

  it("provides React and Vue handler shims", () => {
    const integration = captureFrameworkErrorsIntegration();
    const { context, capture } = createIntegrationContext();
    integration.setup(context);

    const reactError = new Error("react boom");
    integration.reactComponentDidCatch(reactError, { componentStack: "\n  at App" });
    const vueError = new Error("vue boom");
    integration.vueErrorHandler(
      vueError,
      { $options: { name: "CheckoutView" } },
      "render function",
    );

    expect(capture).toHaveBeenCalledWith({
      level: "error",
      message: "react boom",
      error: reactError,
      props: {
        browser: expect.objectContaining({
          componentStack: "\n  at App",
          framework: "react",
          kind: "framework-error",
        }),
      },
      source: "integration:capture-framework-errors",
    });
    expect(capture).toHaveBeenCalledWith({
      level: "error",
      message: "vue boom",
      error: vueError,
      props: {
        browser: expect.objectContaining({
          componentName: "CheckoutView",
          framework: "vue",
          info: "render function",
          kind: "framework-error",
        }),
      },
      source: "integration:capture-framework-errors",
    });
  });

  it("does not queue new errors after teardown", () => {
    const integration = captureFrameworkErrorsIntegration();
    const { context, capture } = createIntegrationContext();
    const teardown = integration.setup(context);

    if (typeof teardown === "function") teardown();
    integration.capture(new Error("late"));
    integration.setup(context);

    expect(capture).not.toHaveBeenCalled();
  });
});
