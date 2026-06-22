import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createIntegrationSetupContext,
  type CaptureInput,
  type IntegrationSetupContext,
  type LoggerLike,
} from "@loggerjs/core";
import {
  captureReportingIntegration,
  type BrowserReportLike,
  type BrowserReportingObserverLike,
} from "../src";

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

class FakeReportingObserver implements BrowserReportingObserverLike {
  static instances: FakeReportingObserver[] = [];

  disconnected = false;
  observed = false;
  records: BrowserReportLike[] = [];

  constructor(
    private readonly callback: (
      reports: BrowserReportLike[],
      observer: BrowserReportingObserverLike,
    ) => void,
    readonly options?: { buffered?: boolean; types?: readonly string[] },
  ) {
    FakeReportingObserver.instances.push(this);
  }

  observe() {
    this.observed = true;
  }

  disconnect() {
    this.disconnected = true;
  }

  takeRecords() {
    const records = this.records;
    this.records = [];
    return records;
  }

  emit(reports: BrowserReportLike[]) {
    this.callback(reports, this);
  }
}

class ThrowingReportingObserver implements BrowserReportingObserverLike {
  constructor() {
    throw new Error("observer unavailable");
  }

  observe() {}

  disconnect() {}
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

function createIntegrationContext(): {
  context: IntegrationSetupContext;
  capture: ReturnType<typeof vi.fn<(input: CaptureInput) => void>>;
} {
  const logger = createLogger();
  const capture = vi.fn<(input: CaptureInput) => void>();
  const context = createIntegrationSetupContext({
    name: "capture-reporting",
    logger,
    capture,
    getLogger: () => logger,
  });
  return { context, capture };
}

function createListenerHarness() {
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

  return {
    addEventListener,
    removeEventListener,
    dispatch(type: string, event: Event) {
      for (const listener of listeners.get(type) ?? []) {
        if (typeof listener === "function") listener(event);
        else listener.handleEvent(event);
      }
    },
  };
}

describe("captureReportingIntegration", () => {
  afterEach(() => {
    FakeReportingObserver.instances = [];
    vi.restoreAllMocks();
  });

  it("captures CSP violation events and removes listeners", () => {
    const harness = createListenerHarness();
    const { context, capture } = createIntegrationContext();
    const teardown = captureReportingIntegration({
      ReportingObserver: undefined,
      addEventListener: harness.addEventListener,
      removeEventListener: harness.removeEventListener,
      sanitizeUrl: (url) => url.replace(/token=[^&]+/, "token=[redacted]"),
    }).setup(context);

    harness.dispatch("securitypolicyviolation", {
      blockedURI: "https://evil.example/script.js?token=secret",
      columnNumber: 2,
      disposition: "enforce",
      documentURI: "https://app.example",
      effectiveDirective: "script-src-elem",
      lineNumber: 1,
      sample: "alert(1)",
      sourceFile: "https://app.example/index.html",
      statusCode: 200,
      violatedDirective: "script-src",
    } as unknown as SecurityPolicyViolationEvent);

    expect(capture).toHaveBeenCalledWith({
      level: "warn",
      message: "Security policy violation: script-src-elem",
      props: {
        browser: {
          kind: "securitypolicyviolation",
          report: expect.objectContaining({
            blockedURI: "https://evil.example/script.js?token=[redacted]",
            effectiveDirective: "script-src-elem",
            sample: "alert(1)",
            type: "securitypolicyviolation",
          }),
        },
      },
      source: "integration:capture-reporting",
    });

    if (typeof teardown === "function") teardown();
    expect(harness.removeEventListener).toHaveBeenCalledWith(
      "securitypolicyviolation",
      expect.any(Function),
    );
  });

  it("captures ReportingObserver reports and drains records on teardown", () => {
    const { context, capture } = createIntegrationContext();
    const teardown = captureReportingIntegration({
      ReportingObserver: FakeReportingObserver,
      addEventListener: undefined,
      buffered: true,
      reportTypes: ["deprecation", "intervention"],
    }).setup(context);

    const observer = FakeReportingObserver.instances[0]!;
    observer.emit([
      {
        type: "deprecation",
        url: "https://app.example",
        body: { id: "old-api" },
      },
    ]);
    observer.records.push({
      type: "intervention",
      url: "https://app.example/video",
      body: { id: "autoplay" },
    });

    if (typeof teardown === "function") teardown();

    expect(observer.observed).toBe(true);
    expect(observer.options).toEqual({
      buffered: true,
      types: ["deprecation", "intervention"],
    });
    expect(observer.disconnected).toBe(true);
    expect(capture).toHaveBeenCalledWith({
      level: "info",
      message: "Browser report deprecation",
      props: {
        browser: {
          kind: "report",
          report: {
            body: { id: "old-api" },
            type: "deprecation",
            url: "https://app.example",
          },
        },
      },
      source: "integration:capture-reporting",
    });
    expect(capture).toHaveBeenCalledWith({
      level: "warn",
      message: "Browser report intervention",
      props: {
        browser: {
          kind: "report",
          report: {
            body: { id: "autoplay" },
            type: "intervention",
            url: "https://app.example/video",
          },
        },
      },
      source: "integration:capture-reporting",
    });
  });

  it("ignores ReportingObserver constructor failures", () => {
    const { context, capture } = createIntegrationContext();

    expect(() => {
      const teardown = captureReportingIntegration({
        ReportingObserver: ThrowingReportingObserver,
        addEventListener: undefined,
      }).setup(context);
      if (typeof teardown === "function") teardown();
    }).not.toThrow();

    expect(capture).not.toHaveBeenCalled();
  });

  it("respects disabled capture switches", () => {
    const harness = createListenerHarness();
    const { context, capture } = createIntegrationContext();
    const teardown = captureReportingIntegration({
      ReportingObserver: FakeReportingObserver,
      addEventListener: harness.addEventListener,
      removeEventListener: harness.removeEventListener,
      captureReportingObserver: false,
      captureSecurityPolicyViolation: false,
    }).setup(context);

    if (typeof teardown === "function") teardown();

    expect(harness.addEventListener).not.toHaveBeenCalled();
    expect(FakeReportingObserver.instances).toHaveLength(0);
    expect(capture).not.toHaveBeenCalled();
  });

  it("normalizes toJSON reports and supports dynamic levels", () => {
    const { context, capture } = createIntegrationContext();
    captureReportingIntegration({
      ReportingObserver: FakeReportingObserver,
      addEventListener: undefined,
      level(report) {
        return report.type === "crash" ? "error" : "info";
      },
      sanitizeUrl: (url) => url.replace(/token=[^&]+/, "token=[redacted]"),
    }).setup(context);

    FakeReportingObserver.instances[0]?.emit([
      {
        type: "ignored",
        url: "https://fallback.example",
        body: { ignored: true },
        toJSON() {
          return {
            body: { id: "renderer-crash" },
            type: "crash",
            url: "https://app.example/report?token=secret",
          };
        },
      },
    ]);

    expect(capture).toHaveBeenCalledWith({
      level: "error",
      message: "Browser report crash",
      props: {
        browser: {
          kind: "report",
          report: {
            body: { id: "renderer-crash" },
            type: "crash",
            url: "https://app.example/report?token=[redacted]",
          },
        },
      },
      source: "integration:capture-reporting",
    });
  });
});
