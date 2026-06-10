import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createIntegrationSetupContext,
  type CaptureInput,
  type IntegrationSetupContext,
  type LoggerLike,
} from "@loggerjs/core";
import { capturePerformanceIntegration, normalizeBrowserPerformanceEntry } from "../src";

class FakePerformanceObserver {
  static supportedEntryTypes = ["longtask", "measure", "navigation", "resource"];
  static instances: FakePerformanceObserver[] = [];

  type = "";
  disconnected = false;

  constructor(private readonly callback: PerformanceObserverCallback) {
    FakePerformanceObserver.instances.push(this);
  }

  observe(init: PerformanceObserverInit) {
    this.type = init.type ?? "";
  }

  disconnect() {
    this.disconnected = true;
  }

  emit(entries: PerformanceEntry[]) {
    this.callback(
      {
        getEntries: () => entries,
      } as PerformanceObserverEntryList,
      this as unknown as PerformanceObserver,
    );
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

function createIntegrationContext(): {
  context: IntegrationSetupContext;
  capture: ReturnType<typeof vi.fn<(input: CaptureInput) => void>>;
} {
  const logger = createLogger();
  const capture = vi.fn<(input: CaptureInput) => void>();
  const context = createIntegrationSetupContext({
    name: "capture-performance",
    logger,
    capture,
    getLogger: () => logger,
  });
  return { context, capture };
}

function entry(
  entryType: string,
  name: string,
  startTime: number,
  duration: number,
  patch: Record<string, unknown> = {},
): PerformanceEntry {
  return {
    name,
    entryType,
    startTime,
    duration,
    toJSON: () => ({}),
    ...patch,
  } as PerformanceEntry;
}

describe("capturePerformanceIntegration", () => {
  afterEach(() => {
    FakePerformanceObserver.instances = [];
    vi.restoreAllMocks();
  });

  it("captures existing performance entries with filtering and sanitization", () => {
    const { context, capture } = createIntegrationContext();
    const performance = {
      getEntriesByType: vi.fn<(type: string) => PerformanceEntry[]>((type) => {
        if (type === "navigation")
          return [entry("navigation", "https://example.com/?token=secret", 0, 120)];
        if (type === "resource")
          return [
            entry("resource", "https://cdn.example.com/app.js?token=secret", 10, 25, {
              decodedBodySize: 1000,
              initiatorType: "script",
              transferSize: 500,
            }),
            entry("resource", "https://cdn.example.com/pixel.gif", 20, 2),
          ];
        return [];
      }),
    };

    capturePerformanceIntegration({
      PerformanceObserver: undefined,
      entryTypes: ["navigation", "resource"],
      minDurationMs: { resource: 10 },
      performance,
      sanitizeName: (name) => name.replace(/token=[^&]+/, "token=[redacted]"),
    }).setup(context);

    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture).toHaveBeenCalledWith({
      level: "info",
      message: "Performance navigation https://example.com/?token=[redacted]",
      props: {
        performance: expect.objectContaining({
          duration: 120,
          entryType: "navigation",
          name: "https://example.com/?token=[redacted]",
        }),
      },
      source: "integration:capture-performance",
    });
    expect(capture).toHaveBeenCalledWith({
      level: "info",
      message: "Performance resource https://cdn.example.com/app.js?token=[redacted]",
      props: {
        performance: expect.objectContaining({
          decodedBodySize: 1000,
          initiatorType: "script",
          transferSize: 500,
        }),
      },
      source: "integration:capture-performance",
    });
  });

  it("observes buffered entries, dedupes, caps entries, and disconnects", () => {
    const { context, capture } = createIntegrationContext();
    const teardown = capturePerformanceIntegration({
      PerformanceObserver: FakePerformanceObserver as unknown as typeof PerformanceObserver,
      entryTypes: ["longtask", "measure"],
      maxEntries: 2,
      performance: { getEntriesByType: () => [] },
    }).setup(context);

    const longtask = entry("longtask", "self", 30, 80);
    FakePerformanceObserver.instances
      .find((observer) => observer.type === "longtask")
      ?.emit([longtask, longtask]);
    FakePerformanceObserver.instances
      .find((observer) => observer.type === "measure")
      ?.emit([entry("measure", "route-change", 100, 40), entry("measure", "ignored", 200, 50)]);

    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture).toHaveBeenCalledWith({
      level: "warn",
      message: "Performance longtask self",
      props: {
        performance: expect.objectContaining({
          duration: 80,
          entryType: "longtask",
          name: "self",
        }),
      },
      source: "integration:capture-performance",
    });
    expect(capture).toHaveBeenCalledWith({
      level: "info",
      message: "Performance measure route-change",
      props: {
        performance: expect.objectContaining({
          duration: 40,
          entryType: "measure",
          name: "route-change",
        }),
      },
      source: "integration:capture-performance",
    });

    if (typeof teardown === "function") teardown();
    expect(FakePerformanceObserver.instances.every((observer) => observer.disconnected)).toBe(true);
  });

  it("normalizes optional resource timing fields", () => {
    const payload = normalizeBrowserPerformanceEntry(
      entry("resource", "/api/users", 1, 2, {
        nextHopProtocol: "h2",
        renderBlockingStatus: "blocking",
        responseStatus: 200,
      }),
      { captureDetail: true },
    );

    expect(payload).toMatchObject({
      duration: 2,
      entryType: "resource",
      name: "/api/users",
      nextHopProtocol: "h2",
      renderBlockingStatus: "blocking",
      responseStatus: 200,
    });
  });
});
