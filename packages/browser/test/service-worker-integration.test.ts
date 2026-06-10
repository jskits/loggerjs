import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createIntegrationSetupContext,
  type CaptureInput,
  type IntegrationSetupContext,
  type LoggerLike,
} from "@loggerjs/core";
import {
  captureServiceWorkerIntegration,
  type BrowserServiceWorkerContainerEventsLike,
} from "../src";

type Listener = EventListenerOrEventListenerObject;

class FakeServiceWorkerContainer implements BrowserServiceWorkerContainerEventsLike {
  controller = {
    scriptURL: "https://app.example/sw.js?token=secret",
    state: "activated",
  };
  readonly listeners = new Map<string, Listener[]>();

  addEventListener(type: string, listener: Listener) {
    const items = this.listeners.get(type) ?? [];
    items.push(listener);
    this.listeners.set(type, items);
  }

  removeEventListener(type: string, listener: Listener) {
    const items = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      items.filter((item) => item !== listener),
    );
  }

  emit(type: string, patch: Record<string, unknown> = {}) {
    const event = { type, ...patch } as Event;
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === "function") listener.call(this, event);
      else listener.handleEvent(event);
    }
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
    name: "capture-service-worker",
    logger,
    capture,
    getLogger: () => logger,
  });
  return { context, capture };
}

describe("captureServiceWorkerIntegration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("captures controller changes and service worker messages without data by default", () => {
    const serviceWorker = new FakeServiceWorkerContainer();
    const { context, capture } = createIntegrationContext();
    const teardown = captureServiceWorkerIntegration({
      serviceWorker,
      sanitizeUrl: (url) => url.replace(/token=[^&]+/, "token=[redacted]"),
    }).setup(context);

    serviceWorker.emit("controllerchange");
    serviceWorker.emit("message", {
      data: "secret payload",
      lastEventId: "evt-1",
      origin: "https://app.example",
    });

    expect(capture).toHaveBeenCalledWith({
      level: "debug",
      message: "Service worker controller change",
      props: {
        browser: {
          kind: "service-worker",
          event: "controllerchange",
          controller: {
            scriptURL: "https://app.example/sw.js?token=[redacted]",
            state: "activated",
          },
        },
      },
      source: "integration:capture-service-worker",
    });
    expect(capture).toHaveBeenCalledWith({
      level: "debug",
      message: "Service worker message",
      props: {
        browser: {
          kind: "service-worker",
          event: "message",
          message: {
            byteLength: 14,
            data: undefined,
            dataType: "string",
            lastEventId: "evt-1",
            origin: "https://app.example",
          },
        },
      },
      source: "integration:capture-service-worker",
    });

    if (typeof teardown === "function") teardown();
    expect(serviceWorker.listeners.get("message")).toHaveLength(0);
  });

  it("captures message errors", () => {
    const serviceWorker = new FakeServiceWorkerContainer();
    const { context, capture } = createIntegrationContext();
    captureServiceWorkerIntegration({ serviceWorker }).setup(context);

    serviceWorker.emit("messageerror");

    expect(capture).toHaveBeenCalledWith({
      level: "warn",
      message: "Service worker message error",
      props: {
        browser: {
          kind: "service-worker",
          event: "messageerror",
          type: "messageerror",
        },
      },
      source: "integration:capture-service-worker",
    });
  });
});
