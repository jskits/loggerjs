import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createIntegrationSetupContext,
  type CaptureInput,
  type IntegrationSetupContext,
  type LoggerLike,
} from "@loggerjs/core";
import { captureWebVitalsIntegration } from "../src";

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

class FakePerformanceObserver {
  static supportedEntryTypes = ["event", "largest-contentful-paint", "layout-shift", "paint"];
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
    name: "capture-web-vitals",
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
    dispatch(type: string, event: Event = new Event(type)) {
      for (const listener of listeners.get(type) ?? []) {
        if (typeof listener === "function") listener(event);
        else listener.handleEvent(event);
      }
    },
  };
}

function entry(
  name: string,
  startTime: number,
  patch: Record<string, unknown> = {},
): PerformanceEntry {
  return {
    name,
    entryType: name,
    startTime,
    duration: 0,
    toJSON: () => ({}),
    ...patch,
  } as PerformanceEntry;
}

describe("captureWebVitalsIntegration", () => {
  afterEach(() => {
    FakePerformanceObserver.instances = [];
    vi.restoreAllMocks();
  });

  it("captures initial TTFB and FCP entries", () => {
    const { context, capture } = createIntegrationContext();
    const performance = {
      getEntriesByType: vi.fn<(type: string) => PerformanceEntry[]>((type) =>
        type === "navigation" ? [entry("navigation", 0, { responseStart: 123 })] : [],
      ),
      getEntriesByName: vi.fn<(name: string) => PerformanceEntry[]>((name) =>
        name === "first-contentful-paint" ? [entry(name, 456)] : [],
      ),
    };

    captureWebVitalsIntegration({
      PerformanceObserver: undefined,
      performance: performance as Pick<Performance, "getEntriesByName" | "getEntriesByType">,
    }).setup(context);

    expect(capture).toHaveBeenCalledWith({
      level: "info",
      message: "Web vital TTFB 123",
      props: {
        webVital: expect.objectContaining({
          name: "TTFB",
          value: 123,
          delta: 123,
          final: true,
        }),
      },
      source: "integration:capture-web-vitals",
    });
    expect(capture).toHaveBeenCalledWith({
      level: "info",
      message: "Web vital FCP 456",
      props: {
        webVital: expect.objectContaining({
          name: "FCP",
          value: 456,
          delta: 456,
          final: true,
        }),
      },
      source: "integration:capture-web-vitals",
    });
  });

  it("flushes CLS, LCP, and INP on pagehide and tears down observers", () => {
    const harness = createListenerHarness();
    const { context, capture } = createIntegrationContext();

    const teardown = captureWebVitalsIntegration({
      metrics: ["CLS", "LCP", "INP"],
      PerformanceObserver: FakePerformanceObserver as unknown as typeof PerformanceObserver,
      performance: undefined,
      addEventListener: harness.addEventListener,
      removeEventListener: harness.removeEventListener,
    }).setup(context);

    FakePerformanceObserver.instances
      .find((observer) => observer.type === "layout-shift")
      ?.emit([entry("layout-shift", 10, { value: 0.05, hadRecentInput: false })]);
    FakePerformanceObserver.instances
      .find((observer) => observer.type === "largest-contentful-paint")
      ?.emit([entry("largest-contentful-paint", 2500)]);
    FakePerformanceObserver.instances
      .find((observer) => observer.type === "event")
      ?.emit([entry("pointerdown", 100, { duration: 180 })]);

    harness.dispatch("pagehide");

    expect(capture).toHaveBeenCalledWith({
      level: "info",
      message: "Web vital CLS 0.05",
      props: {
        webVital: expect.objectContaining({ name: "CLS", value: 0.05, final: true }),
      },
      source: "integration:capture-web-vitals",
    });
    expect(capture).toHaveBeenCalledWith({
      level: "info",
      message: "Web vital LCP 2500",
      props: {
        webVital: expect.objectContaining({ name: "LCP", value: 2500, final: true }),
      },
      source: "integration:capture-web-vitals",
    });
    expect(capture).toHaveBeenCalledWith({
      level: "info",
      message: "Web vital INP 180",
      props: {
        webVital: expect.objectContaining({ name: "INP", value: 180, final: true }),
      },
      source: "integration:capture-web-vitals",
    });

    if (typeof teardown === "function") teardown();

    expect(FakePerformanceObserver.instances.every((observer) => observer.disconnected)).toBe(true);
    expect(harness.removeEventListener).toHaveBeenCalledWith("pagehide", expect.any(Function));
    expect(harness.removeEventListener).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );
  });
});
