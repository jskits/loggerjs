import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createIntegrationSetupContext,
  type CaptureInput,
  type IntegrationSetupContext,
  type LoggerLike,
} from "@loggerjs/core";
import { pageLifecycleIntegration } from "../src";

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
  dispatch: (type: string) => void;
}

function createLogger(flush: LoggerLike["flush"]): LoggerLike {
  return {
    log: vi.fn<LoggerLike["log"]>(),
    trace: vi.fn<LoggerLike["trace"]>(),
    debug: vi.fn<LoggerLike["debug"]>(),
    info: vi.fn<LoggerLike["info"]>(),
    warn: vi.fn<LoggerLike["warn"]>(),
    error: vi.fn<LoggerLike["error"]>(),
    fatal: vi.fn<LoggerLike["fatal"]>(),
    captureException: vi.fn<LoggerLike["captureException"]>(),
    flush,
    close: vi.fn<LoggerLike["close"]>(async () => {}),
  };
}

function createIntegrationContext(logger: LoggerLike): IntegrationSetupContext {
  return createIntegrationSetupContext({
    name: "page-lifecycle",
    logger,
    capture: vi.fn<(input: CaptureInput) => void>(),
    getLogger: () => logger,
  });
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
    dispatch(type) {
      for (const listener of listeners.get(type) ?? []) {
        const event = new Event(type);
        if (typeof listener === "function") listener(event);
        else listener.handleEvent(event);
      }
    },
  };
}

describe("pageLifecycleIntegration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("coalesces hidden and pagehide flushes while a flush is in flight", () => {
    const harness = createListenerHarness();
    vi.stubGlobal("document", { visibilityState: "hidden" });
    let resolveFlush: (() => void) | undefined;
    const flush = vi.fn<LoggerLike["flush"]>(
      () =>
        new Promise<void>((resolve) => {
          resolveFlush = resolve;
        }),
    );
    const logger = createLogger(flush);

    pageLifecycleIntegration().setup(createIntegrationContext(logger));

    harness.dispatch("visibilitychange");
    harness.dispatch("pagehide");

    expect(flush).toHaveBeenCalledTimes(1);
    resolveFlush?.();
  });

  it("removes lifecycle listeners on teardown", () => {
    const harness = createListenerHarness();
    const flush = vi.fn<LoggerLike["flush"]>(async () => {});
    const logger = createLogger(flush);

    const teardown = pageLifecycleIntegration().setup(createIntegrationContext(logger));

    expect(harness.addEventListener).toHaveBeenCalledWith("pagehide", expect.any(Function));
    expect(harness.addEventListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));

    if (typeof teardown === "function") {
      teardown();
      teardown();
    }

    expect(harness.removeEventListener).toHaveBeenCalledTimes(2);
    expect(harness.removeEventListener).toHaveBeenCalledWith("pagehide", expect.any(Function));
    expect(harness.removeEventListener).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );
  });
});
