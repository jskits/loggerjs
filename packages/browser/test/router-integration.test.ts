import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createIntegrationSetupContext,
  type CaptureInput,
  type IntegrationSetupContext,
  type LoggerLike,
} from "@loggerjs/core";
import { captureRouterIntegration, type BrowserHistoryLike } from "../src";

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
    name: "capture-router",
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

describe("captureRouterIntegration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("captures initial routes and History API changes", () => {
    const harness = createListenerHarness();
    const { context, capture } = createIntegrationContext();
    const originalPushState = vi.fn<NonNullable<BrowserHistoryLike["pushState"]>>();
    const originalReplaceState = vi.fn<NonNullable<BrowserHistoryLike["replaceState"]>>();
    const history: BrowserHistoryLike = {
      state: { initial: true },
      pushState: originalPushState,
      replaceState: originalReplaceState,
    };

    const teardown = captureRouterIntegration({
      addEventListener: harness.addEventListener,
      history,
      includeState: true,
      location: { href: "https://app.example/start?token=secret#top" },
      removeEventListener: harness.removeEventListener,
      sanitizeUrl: (url) => url.replace(/token=[^&#]+/, "token=[redacted]"),
    }).setup(context);

    history.pushState?.({ page: "orders" }, "", "/orders?token=secret");
    history.replaceState?.({ page: "orders", tab: "open" }, "", "/orders/open");

    expect(originalPushState).toHaveBeenCalledWith({ page: "orders" }, "", "/orders?token=secret");
    expect(originalReplaceState).toHaveBeenCalledWith(
      { page: "orders", tab: "open" },
      "",
      "/orders/open",
    );
    expect(capture).toHaveBeenCalledWith({
      level: "info",
      message: "Route initial /start?token=[redacted]#top",
      props: {
        browser: {
          kind: "route-change",
          route: {
            from: undefined,
            state: { initial: true },
            to: "/start?token=[redacted]#top",
            trigger: "initial",
          },
        },
      },
      source: "integration:capture-router",
    });
    expect(capture).toHaveBeenCalledWith({
      level: "info",
      message: "Route change /orders?token=[redacted]",
      props: {
        browser: {
          kind: "route-change",
          route: {
            from: "/start?token=[redacted]#top",
            state: { page: "orders" },
            to: "/orders?token=[redacted]",
            trigger: "pushState",
          },
        },
      },
      source: "integration:capture-router",
    });
    expect(capture).toHaveBeenCalledWith({
      level: "info",
      message: "Route change /orders/open",
      props: {
        browser: {
          kind: "route-change",
          route: {
            from: "/orders?token=[redacted]",
            state: { page: "orders", tab: "open" },
            to: "/orders/open",
            trigger: "replaceState",
          },
        },
      },
      source: "integration:capture-router",
    });

    if (typeof teardown === "function") teardown();

    expect(history.pushState).toBe(originalPushState);
    expect(history.replaceState).toBe(originalReplaceState);
    expect(harness.removeEventListener).toHaveBeenCalledWith("popstate", expect.any(Function));
    expect(harness.removeEventListener).toHaveBeenCalledWith("hashchange", expect.any(Function));
  });

  it("captures popstate and hashchange events", () => {
    const harness = createListenerHarness();
    const { context, capture } = createIntegrationContext();
    const location = { href: "https://app.example/current" };

    captureRouterIntegration({
      addEventListener: harness.addEventListener,
      captureInitial: false,
      history: { state: { page: "current" } },
      location,
      removeEventListener: harness.removeEventListener,
      urlMode: "href",
    }).setup(context);

    location.href = "https://app.example/previous";
    harness.dispatch("popstate", { state: { page: "previous" } } as PopStateEvent);
    harness.dispatch("hashchange", {
      newURL: "https://app.example/previous#details",
    } as HashChangeEvent);

    expect(capture).toHaveBeenCalledWith({
      level: "info",
      message: "Route change https://app.example/previous",
      props: {
        browser: {
          kind: "route-change",
          route: {
            from: "https://app.example/current",
            state: undefined,
            to: "https://app.example/previous",
            trigger: "popstate",
          },
        },
      },
      source: "integration:capture-router",
    });
    expect(capture).toHaveBeenCalledWith({
      level: "info",
      message: "Route change https://app.example/previous#details",
      props: {
        browser: {
          kind: "route-change",
          route: {
            from: "https://app.example/previous",
            state: undefined,
            to: "https://app.example/previous#details",
            trigger: "hashchange",
          },
        },
      },
      source: "integration:capture-router",
    });
  });
});
