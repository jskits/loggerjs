import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createIntegrationSetupContext,
  type CaptureInput,
  type IntegrationSetupContext,
  type LoggerLike,
} from "@loggerjs/core";
import { captureUserActionsIntegration, type BrowserEventTargetLike } from "../src";

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
    name: "capture-user-actions",
    logger,
    capture,
    getLogger: () => logger,
  });
  return { context, capture };
}

function createRoot(): BrowserEventTargetLike & {
  dispatch: (type: string, target: EventTarget) => void;
  addEventListener: ReturnType<typeof vi.fn<AddListener>>;
  removeEventListener: ReturnType<typeof vi.fn<RemoveListener>>;
} {
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
    dispatch(type, target) {
      const event = { target, type } as Event;
      for (const listener of listeners.get(type) ?? []) {
        if (typeof listener === "function") listener(event);
        else listener.handleEvent(event);
      }
    },
  };
}

function element(patch: Record<string, unknown> = {}): EventTarget {
  const attrs = new Map(Object.entries((patch.attrs as Record<string, string>) ?? {}));
  return {
    tagName: "BUTTON",
    getAttribute(name: string) {
      return attrs.get(name) ?? null;
    },
    ...patch,
  } as unknown as EventTarget;
}

describe("captureUserActionsIntegration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("captures delegated user actions with low-sensitive target metadata", () => {
    const root = createRoot();
    const { context, capture } = createIntegrationContext();
    const teardown = captureUserActionsIntegration({
      clock: () => 1000,
      root,
      throttleMs: 0,
    }).setup(context);

    root.dispatch(
      "click",
      element({
        id: "save",
        name: "saveButton",
        textContent: "Save sensitive content",
        value: "secret",
        attrs: { "aria-label": "Save order", role: "button" },
      }),
    );

    expect(capture).toHaveBeenCalledWith({
      level: "info",
      message: "User action click Save order",
      props: {
        browser: {
          kind: "user-action",
          action: {
            type: "click",
            target: {
              href: undefined,
              id: "save",
              label: "Save order",
              name: "saveButton",
              role: "button",
              tagName: "button",
              type: undefined,
            },
          },
        },
      },
      source: "integration:capture-user-actions",
    });

    if (typeof teardown === "function") teardown();
    expect(root.removeEventListener).toHaveBeenCalledWith("click", expect.any(Function), true);
  });

  it("throttles repeated actions and can capture sanitized text and values", () => {
    const root = createRoot();
    const { context, capture } = createIntegrationContext();
    let now = 1000;
    captureUserActionsIntegration({
      captureText: true,
      captureValue: true,
      clock: () => now,
      events: ["input"],
      maxTextLength: 6,
      root,
      sanitize: (value, field) => (field === "value" ? "[redacted]" : value),
      throttleMs: 100,
    }).setup(context);

    const input = element({
      name: "email",
      tagName: "INPUT",
      textContent: "abcdefghi",
      type: "email",
      value: "person@example.com",
    });

    root.dispatch("input", input);
    root.dispatch("input", input);
    now = 1200;
    root.dispatch("input", input);

    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture).toHaveBeenCalledWith({
      level: "info",
      message: "User action input email",
      props: {
        browser: {
          kind: "user-action",
          action: {
            type: "input",
            target: expect.objectContaining({
              label: "email",
              tagName: "input",
              text: "abcdef",
              value: "[redacted]",
            }),
          },
        },
      },
      source: "integration:capture-user-actions",
    });
  });
});
