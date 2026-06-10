import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createIntegrationSetupContext,
  getLoggerMetaStats,
  resetLoggerMetaStats,
  type CaptureInput,
  type IntegrationSetupContext,
  type LoggerLike,
} from "@loggerjs/core";
import { captureBrowserErrorsIntegration } from "../src";

type Listener = EventListenerOrEventListenerObject;
type AddListener = (
  type: string,
  listener: Listener | null,
  options?: boolean | AddEventListenerOptions,
) => void;
type RemoveListener = (
  type: string,
  listener: Listener | null,
  options?: boolean | EventListenerOptions,
) => void;

interface ListenerHarness {
  addEventListener: ReturnType<typeof vi.fn<AddListener>>;
  removeEventListener: ReturnType<typeof vi.fn<RemoveListener>>;
  dispatch: (type: string, event: Event) => void;
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

function createIntegrationContext(logger: LoggerLike): {
  context: IntegrationSetupContext;
  capture: ReturnType<typeof vi.fn<(input: CaptureInput) => void>>;
} {
  const capture = vi.fn<(input: CaptureInput) => void>();
  const context = createIntegrationSetupContext({
    name: "capture-browser-errors",
    logger,
    capture,
    getLogger: () => logger,
  });
  return { context, capture };
}

function createListenerHarness(): ListenerHarness {
  const listeners = new Map<string, Listener[]>();
  const addEventListener = vi.fn<AddListener>((type, listener) => {
    if (!listener) return;
    const items = listeners.get(type) ?? [];
    items.push(listener);
    listeners.set(type, items);
  });
  const removeEventListener = vi.fn<RemoveListener>((type, listener) => {
    const items = listeners.get(type) ?? [];
    listeners.set(
      type,
      items.filter((item) => item !== listener),
    );
  });

  vi.stubGlobal("addEventListener", addEventListener);
  vi.stubGlobal("removeEventListener", removeEventListener);

  return {
    addEventListener,
    removeEventListener,
    dispatch(type, event) {
      for (const listener of listeners.get(type) ?? []) {
        if (typeof listener === "function") listener(event);
        else listener.handleEvent(event);
      }
    },
  };
}

describe("captureBrowserErrorsIntegration", () => {
  afterEach(() => {
    resetLoggerMetaStats();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("captures script errors and unhandled rejections through IntegrationAPI", () => {
    const harness = createListenerHarness();
    const logger = createLogger();
    const { context, capture } = createIntegrationContext(logger);
    const error = new Error("boom");

    captureBrowserErrorsIntegration().setup(context);

    harness.dispatch("error", {
      message: "boom",
      error,
      filename: "app.js",
      lineno: 10,
      colno: 2,
    } as ErrorEvent);
    harness.dispatch("unhandledrejection", {
      reason: "bad promise",
    } as PromiseRejectionEvent);

    expect(capture).toHaveBeenCalledWith({
      level: "error",
      message: "boom",
      error,
      props: {
        browser: {
          kind: "script-error",
          file: "app.js",
          line: 10,
          column: 2,
        },
      },
      source: "integration:capture-browser-errors",
    });
    expect(capture).toHaveBeenCalledWith({
      level: "error",
      message: "Unhandled promise rejection",
      error: "bad promise",
      props: {
        browser: { kind: "unhandledrejection" },
        reason: "bad promise",
      },
      source: "integration:capture-browser-errors",
    });
    expect(logger.captureException).not.toHaveBeenCalled();
  });

  it("captures resource load errors", () => {
    const harness = createListenerHarness();
    const logger = createLogger();
    const { context, capture } = createIntegrationContext(logger);

    captureBrowserErrorsIntegration().setup(context);
    harness.dispatch("error", {
      target: {
        tagName: "IMG",
        src: "https://cdn.example.test/missing.png",
        outerHTML: '<img src="https://cdn.example.test/missing.png">',
      },
    } as unknown as Event);

    expect(capture).toHaveBeenCalledWith({
      level: "error",
      message: "Browser resource load error",
      props: {
        browser: {
          kind: "resource-error",
          tagName: "IMG",
          url: "https://cdn.example.test/missing.png",
          html: '<img src="https://cdn.example.test/missing.png">',
        },
      },
      source: "integration:capture-browser-errors",
    });
  });

  it("deduplicates cross-origin script error storms", () => {
    const harness = createListenerHarness();
    const logger = createLogger();
    const { context, capture } = createIntegrationContext(logger);

    captureBrowserErrorsIntegration().setup(context);
    const event = { message: "Script error." } as ErrorEvent;

    harness.dispatch("error", event);
    harness.dispatch("error", event);

    expect(capture).toHaveBeenCalledTimes(1);
    expect(getLoggerMetaStats()).toMatchObject({
      "integration.dropped": 1,
      "integration.dropped.script-error-duplicate": 1,
    });
  });

  it("optionally captures security policy violations and removes listeners", () => {
    const harness = createListenerHarness();
    const logger = createLogger();
    const { context, capture } = createIntegrationContext(logger);

    const teardown = captureBrowserErrorsIntegration({
      captureSecurityPolicyViolation: true,
    }).setup(context);

    harness.dispatch("securitypolicyviolation", {
      violatedDirective: "script-src",
      effectiveDirective: "script-src-elem",
      blockedURI: "https://evil.example.test/script.js",
      documentURI: "https://app.example.test",
      sourceFile: "index.html",
      lineNumber: 1,
      columnNumber: 1,
      originalPolicy: "default-src 'self'",
    } as unknown as SecurityPolicyViolationEvent);

    expect(capture).toHaveBeenCalledWith({
      level: "warn",
      message: "Security policy violation: script-src",
      props: {
        browser: {
          kind: "securitypolicyviolation",
          blockedURI: "https://evil.example.test/script.js",
          documentURI: "https://app.example.test",
          file: "index.html",
          line: 1,
          column: 1,
          originalPolicy: "default-src 'self'",
          effectiveDirective: "script-src-elem",
        },
      },
      source: "integration:capture-browser-errors",
    });

    if (typeof teardown === "function") teardown();

    expect(harness.removeEventListener).toHaveBeenCalledWith(
      "securitypolicyviolation",
      expect.any(Function),
    );
  });
});
