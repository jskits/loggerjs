import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getLoggerMetaStats,
  recordToEvent,
  resetLoggerMetaStats,
  type Codec,
  type LogEvent,
  type TransportContext,
} from "@loggerjs/core";
import {
  browserWebSocketTransport,
  type BrowserWebSocketEventType,
  type BrowserWebSocketFactory,
  type BrowserWebSocketLike,
  type BrowserWebSocketPayload,
} from "../src";

const textCodec: Codec<BrowserWebSocketPayload> = {
  name: "text",
  contentType: "text/plain",
  encode(input) {
    const items = Array.isArray(input) ? input : [input];
    return items
      .map((item) => {
        if ("message" in item) return item.message;
        return item.msg ?? "";
      })
      .join("|");
  },
};

function createEvent(message: string, seq = 1): LogEvent {
  return {
    id: `evt-${seq}`,
    time: seq,
    seq,
    level: 30,
    levelName: "info",
    logger: "browser",
    message,
  };
}

function createContext(errors: unknown[] = []): TransportContext {
  return {
    loggerName: "browser",
    now: () => 1,
    toEvent: recordToEvent,
    reportInternalError(error) {
      errors.push(error);
    },
  };
}

class FakeWebSocket implements BrowserWebSocketLike {
  readyState = 0;
  readonly sent: unknown[] = [];
  readonly listeners = new Map<BrowserWebSocketEventType, Set<(event: Event) => void>>();
  closedWith: [number | undefined, string | undefined] | undefined;
  sendError: unknown;

  send(data: Parameters<WebSocket["send"]>[0]) {
    if (this.sendError) throw this.sendError;
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    this.readyState = 3;
    this.closedWith = [code, reason];
    this.emit("close");
  }

  addEventListener(type: BrowserWebSocketEventType, listener: (event: Event) => void) {
    const listeners = this.listeners.get(type) ?? new Set<(event: Event) => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: BrowserWebSocketEventType, listener: (event: Event) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  open() {
    this.readyState = 1;
    this.emit("open");
  }

  emit(type: BrowserWebSocketEventType) {
    for (const listener of this.listeners.get(type) ?? []) listener(new Event(type));
  }

  listenerCount(type: BrowserWebSocketEventType) {
    return this.listeners.get(type)?.size ?? 0;
  }
}

describe("browserWebSocketTransport", () => {
  afterEach(() => {
    resetLoggerMetaStats();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("queues payloads while connecting and drains on open", () => {
    const sockets: FakeWebSocket[] = [];
    const factory = vi.fn<BrowserWebSocketFactory>((url, protocols) => {
      expect(url).toBe("wss://logs.example");
      expect(protocols).toEqual(["loggerjs"]);
      const socket = new FakeWebSocket();
      sockets.push(socket);
      return socket;
    });
    const transport = browserWebSocketTransport({
      url: "wss://logs.example",
      protocols: ["loggerjs"],
      codec: textCodec,
      webSocketFactory: factory,
    });
    const context = createContext();

    transport.log?.(createEvent("one", 1), context);
    transport.logBatch?.([createEvent("two", 2), createEvent("three", 3)], context);

    expect(transport.queueSize()).toBe(2);
    expect(sockets[0]?.sent).toEqual([]);

    sockets[0]?.open();

    expect(transport.queueSize()).toBe(0);
    expect(sockets[0]?.sent).toEqual(["one", "two|three"]);
  });

  it("sends immediately when the socket is already open", () => {
    const socket = new FakeWebSocket();
    socket.readyState = 1;
    const transport = browserWebSocketTransport({
      url: "wss://logs.example",
      codec: textCodec,
      webSocketFactory: () => socket,
    });

    transport.log?.(createEvent("ready"), createContext());

    expect(transport.queueSize()).toBe(0);
    expect(socket.sent).toEqual(["ready"]);
  });

  it("does not create a socket for empty batches", () => {
    const factory = vi.fn<BrowserWebSocketFactory>(() => new FakeWebSocket());
    const transport = browserWebSocketTransport({
      url: "wss://logs.example",
      codec: textCodec,
      webSocketFactory: factory,
    });

    transport.logBatch?.([], createContext());

    expect(factory).not.toHaveBeenCalled();
    expect(transport.queueSize()).toBe(0);
  });

  it("copies Uint8Array payloads before sending", () => {
    const socket = new FakeWebSocket();
    socket.readyState = 1;
    const payload = new Uint8Array([1, 2, 3]);
    const codec: Codec<BrowserWebSocketPayload> = {
      name: "binary",
      contentType: "application/octet-stream",
      encode: vi.fn<Codec<BrowserWebSocketPayload>["encode"]>(() => payload),
    };
    const transport = browserWebSocketTransport({
      url: "wss://logs.example",
      codec,
      webSocketFactory: () => socket,
    });

    transport.log?.(createEvent("binary"), createContext());

    expect(socket.sent).toEqual([payload]);
    expect(socket.sent[0]).not.toBe(payload);
  });

  it("drops queued payloads according to the configured policy", () => {
    const dropped: string[] = [];
    const transport = browserWebSocketTransport({
      url: "wss://logs.example",
      codec: textCodec,
      maxQueueSize: 1,
      dropPolicy: "drop-newest",
      webSocketFactory: () => new FakeWebSocket(),
      onDrop(event, reason) {
        dropped.push(`${event.message}:${reason}`);
      },
    });

    transport.log?.(createEvent("kept", 1), createContext());
    transport.log?.(createEvent("dropped", 2), createContext());

    expect(transport.queueSize()).toBe(1);
    expect(dropped).toEqual(["dropped:queue-full"]);
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.dropped": 1,
      "transport.dropped.queue-full": 1,
    });
  });

  it("reports default WebSocket unavailability as dropped events", () => {
    vi.stubGlobal("WebSocket", undefined);
    const errors: unknown[] = [];
    const transport = browserWebSocketTransport({
      url: "wss://logs.example",
      codec: textCodec,
    });

    transport.log?.(createEvent("lost"), createContext(errors));

    expect(errors).toHaveLength(1);
    expect(transport.queueSize()).toBe(0);
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.dropped": 1,
      "transport.dropped.create-socket": 1,
    });
  });

  it("reports socket creation and send failures", () => {
    const createErrors: unknown[] = [];
    const onError = vi.fn<(error: unknown, detail: unknown) => void>();
    const createFailingTransport = browserWebSocketTransport({
      url: "wss://logs.example",
      codec: textCodec,
      webSocketFactory() {
        throw new Error("unsupported");
      },
      onError,
    });

    createFailingTransport.log?.(createEvent("lost"), createContext(createErrors));

    expect(createErrors).toHaveLength(1);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), {
      droppedEvents: 1,
      operation: "create-socket",
    });
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.dropped": 1,
      "transport.dropped.create-socket": 1,
    });

    resetLoggerMetaStats();
    const sendErrors: unknown[] = [];
    const socket = new FakeWebSocket();
    socket.readyState = 1;
    socket.sendError = new Error("send failed");
    const sendFailingTransport = browserWebSocketTransport({
      url: "wss://logs.example",
      codec: textCodec,
      webSocketFactory: () => socket,
    });

    sendFailingTransport.log?.(createEvent("lost"), createContext(sendErrors));

    expect(sendErrors).toHaveLength(1);
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.dropped": 1,
      "transport.dropped.send": 1,
    });
  });

  it("reports onError callback failures without hiding send errors", () => {
    const errors: unknown[] = [];
    const socket = new FakeWebSocket();
    socket.readyState = 1;
    socket.sendError = new Error("send failed");
    const transport = browserWebSocketTransport({
      url: "wss://logs.example",
      codec: textCodec,
      webSocketFactory: () => socket,
      onError() {
        throw new Error("observer failed");
      },
    });

    transport.log?.(createEvent("lost"), createContext(errors));

    expect(errors).toHaveLength(2);
    expect(String(errors[0])).toContain("observer failed");
    expect(String(errors[1])).toContain("send failed");
  });

  it("closes the socket, detaches listeners, and drops queued payloads", async () => {
    const socket = new FakeWebSocket();
    const transport = browserWebSocketTransport({
      url: "wss://logs.example",
      codec: textCodec,
      closeCode: 1000,
      closeReason: "done",
      webSocketFactory: () => socket,
    });

    transport.log?.(createEvent("queued"), createContext());
    await transport.close?.();

    expect(socket.closedWith).toEqual([1000, "done"]);
    expect(socket.listenerCount("open")).toBe(0);
    expect(socket.listenerCount("close")).toBe(0);
    expect(socket.listenerCount("error")).toBe(0);
    expect(transport.queueSize()).toBe(0);
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.dropped": 1,
      "transport.dropped.closed": 1,
    });
  });

  it("reports socket close failures", async () => {
    const errors: unknown[] = [];
    class CloseFailingWebSocket extends FakeWebSocket {
      override close() {
        throw new Error("close failed");
      }
    }
    const socket = new CloseFailingWebSocket();
    const onError = vi.fn<(error: unknown, detail: unknown) => void>();
    const transport = browserWebSocketTransport({
      url: "wss://logs.example",
      codec: textCodec,
      webSocketFactory: () => socket,
      onError,
    });

    transport.log?.(createEvent("queued"), createContext(errors));
    await transport.close?.();

    expect(onError).toHaveBeenCalledWith(expect.any(Error), {
      droppedEvents: 0,
      operation: "close-socket",
    });
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain("close failed");
  });
});
