import { describe, expect, it, vi } from "vitest";
import { createIntegrationSetupContext, type CaptureInput, type LoggerLike } from "@loggerjs/core";
import { nextRouterIntegration, reactRouterIntegration, vueRouterIntegration } from "../src";

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

function createContext() {
  const logger = createLogger();
  const capture = vi.fn<(input: CaptureInput) => void>();
  return {
    capture,
    context: createIntegrationSetupContext({
      name: "framework-router",
      logger,
      capture,
      getLogger: () => logger,
    }),
  };
}

describe("framework router integrations", () => {
  it("captures Next router events and removes listeners", () => {
    const listeners = new Map<string, (url: string) => void>();
    const router = {
      asPath: "/from",
      events: {
        on: vi.fn<(event: string, listener: (url: string) => void) => void>((event, listener) =>
          listeners.set(event, listener),
        ),
        off: vi.fn<(event: string) => void>((event) => {
          listeners.delete(event);
        }),
      },
    };
    const { context, capture } = createContext();

    const teardown = nextRouterIntegration({ router }).setup(context);
    listeners.get("routeChangeComplete")?.("/to");

    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "next route /to",
        props: expect.objectContaining({
          browser: expect.objectContaining({ framework: "next" }),
        }),
      }),
    );

    if (typeof teardown === "function") teardown();
    expect(router.events.off).toHaveBeenCalledWith("routeChangeComplete", expect.any(Function));
  });

  it("captures React Router history updates", () => {
    let listener: ((update: unknown) => void) | undefined;
    const { context, capture } = createContext();
    reactRouterIntegration({
      history: {
        location: { pathname: "/from" },
        listen(next) {
          listener = next;
          return () => {};
        },
      },
    }).setup(context);

    listener?.({ location: { pathname: "/to" } });

    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "react-router route /to",
      }),
    );
  });

  it("captures Vue Router afterEach hooks", () => {
    let listener: ((to: unknown, from: unknown) => void) | undefined;
    const { context, capture } = createContext();
    vueRouterIntegration({
      router: {
        afterEach(next) {
          listener = next;
        },
      },
    }).setup(context);

    listener?.({ fullPath: "/to" }, { fullPath: "/from" });

    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "vue-router route /to",
      }),
    );
  });
});
