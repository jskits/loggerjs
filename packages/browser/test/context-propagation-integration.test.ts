import { afterEach, describe, expect, it } from "vitest";
import {
  createLogger,
  memoryTransport,
  resetContextManager,
  setContextProvider,
} from "@loggerjs/core";
import { browserContextPropagationIntegration, type BrowserContextEventTargetLike } from "../src";

class FakeRoot {
  private listeners = new Map<string, EventListener>();

  addEventListener(type: string, listener: EventListener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type: string, listener: EventListener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }

  dispatch(type: string, target: EventTarget) {
    this.listeners.get(type)?.({ type, target } as Event);
  }
}

describe("browserContextPropagationIntegration", () => {
  afterEach(() => {
    setContextProvider(undefined);
    resetContextManager();
  });

  it("adds session, request, trace, baggage, and recent action context", async () => {
    const root = new FakeRoot();
    const transport = memoryTransport();
    let now = 1000;
    const logger = createLogger({
      integrations: [
        browserContextPropagationIntegration({
          actionTtlMs: 100,
          clock: () => now,
          idFactory: () => "action-1",
          requestId: () => "req-1",
          root: root as unknown as BrowserContextEventTargetLike,
          sessionId: "session-1",
          baggage: { tenant: "acme" },
          traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        }),
      ],
      transports: [transport],
    });

    root.dispatch("click", { id: "save" } as unknown as EventTarget);
    logger.info("created");

    expect(transport.events[0]?.context).toMatchObject({
      actionId: "action-1",
      actionTarget: "save",
      actionType: "click",
      baggage: "tenant=acme",
      requestId: "req-1",
      sessionId: "session-1",
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    });

    now = 1200;
    logger.info("later");
    expect(transport.events[1]?.context).not.toHaveProperty("actionId");

    await logger.close();
  });

  it("restores the previous context provider on teardown", async () => {
    setContextProvider(() => ({ app: "checkout" }));
    const transport = memoryTransport();
    const logger = createLogger({
      integrations: [browserContextPropagationIntegration({ sessionId: "session-1" })],
      transports: [transport],
    });

    logger.info("during");
    await logger.close();
    logger.info("ignored");

    const nextTransport = memoryTransport();
    const nextLogger = createLogger({ transports: [nextTransport] });
    nextLogger.info("after");

    expect(transport.events[0]?.context).toEqual({ app: "checkout", sessionId: "session-1" });
    expect(nextTransport.events[0]?.context).toEqual({ app: "checkout" });
  });
});
