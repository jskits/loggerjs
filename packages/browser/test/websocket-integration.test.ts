import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createIntegrationSetupContext,
  type CaptureInput,
  type IntegrationSetupContext,
  type LoggerLike,
} from "@loggerjs/core";
import { captureWebSocketIntegration, type BrowserCapturedWebSocketLike } from "../src";

type Listener = EventListenerOrEventListenerObject;

class FakeWebSocket implements BrowserCapturedWebSocketLike {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly listeners = new Map<string, Listener[]>();
  readonly sent: unknown[] = [];

  readonly url: string;

  constructor(
    url: string | URL,
    readonly protocols?: string | string[],
  ) {
    this.url = String(url);
    FakeWebSocket.instances.push(this);
  }

  send(data: unknown) {
    this.sent.push(data);
  }

  close() {}

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
    name: "capture-websocket",
    logger,
    capture,
    getLogger: () => logger,
  });
  return { context, capture };
}

describe("captureWebSocketIntegration", () => {
  afterEach(() => {
    FakeWebSocket.instances = [];
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("patches WebSocket and captures lifecycle events", () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const { context, capture } = createIntegrationContext();
    const teardown = captureWebSocketIntegration().setup(context);

    const socket = new WebSocket(
      "wss://example.com/socket?token=secret",
    ) as unknown as FakeWebSocket;
    socket.emit("open");
    socket.emit("close", { code: 1000, reason: "done", wasClean: true });

    expect(capture).toHaveBeenCalledWith({
      level: "debug",
      message: "WebSocket connect wss://example.com/socket",
      props: {
        websocket: expect.objectContaining({
          event: "connect",
          kind: "websocket",
          url: "wss://example.com/socket",
        }),
      },
      source: "integration:capture-websocket",
    });
    expect(capture).toHaveBeenCalledWith({
      level: "debug",
      message: "WebSocket close wss://example.com/socket",
      props: {
        websocket: expect.objectContaining({
          code: 1000,
          event: "close",
          reason: "done",
          wasClean: true,
        }),
      },
      source: "integration:capture-websocket",
    });

    if (typeof teardown === "function") teardown();
    expect(globalThis.WebSocket).toBe(FakeWebSocket);
  });

  it("captures incoming and outgoing message metadata without payload data by default", () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const { context, capture } = createIntegrationContext();
    captureWebSocketIntegration({
      captureMessages: true,
      captureSentMessages: true,
    }).setup(context);

    const socket = new WebSocket("wss://example.com/chat") as unknown as FakeWebSocket;
    socket.send("secret message");
    socket.emit("message", { data: new Uint8Array([1, 2, 3]) });

    expect(socket.sent).toEqual(["secret message"]);
    expect(capture).toHaveBeenCalledWith({
      level: "debug",
      message: "WebSocket send wss://example.com/chat",
      props: {
        websocket: {
          kind: "websocket-message",
          url: "wss://example.com/chat",
          message: {
            byteLength: 14,
            data: undefined,
            dataType: "string",
            direction: "outgoing",
          },
        },
      },
      source: "integration:capture-websocket",
    });
    expect(capture).toHaveBeenCalledWith({
      level: "debug",
      message: "WebSocket message wss://example.com/chat",
      props: {
        websocket: {
          kind: "websocket-message",
          url: "wss://example.com/chat",
          message: {
            byteLength: 3,
            data: undefined,
            dataType: "Uint8Array",
            direction: "incoming",
          },
        },
      },
      source: "integration:capture-websocket",
    });
  });
});
