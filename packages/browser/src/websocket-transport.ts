import {
  incrementLoggerMetaCounter,
  safeJsonCodec,
  type Codec,
  type LogEvent,
  type LoggerLevel,
  type Transport,
  type TransportContext,
} from "@loggerjs/core";

export type BrowserWebSocketDropPolicy = "drop-oldest" | "drop-newest";
export type BrowserWebSocketPayload = string | Uint8Array;
export type BrowserWebSocketEventType = "close" | "error" | "open";
type BrowserWebSocketSendPayload = Parameters<WebSocket["send"]>[0];

export interface BrowserWebSocketLike {
  readonly readyState: number;
  send: (data: BrowserWebSocketSendPayload) => void;
  close: (code?: number, reason?: string) => void;
  addEventListener: (type: BrowserWebSocketEventType, listener: (event: Event) => void) => void;
  removeEventListener: (type: BrowserWebSocketEventType, listener: (event: Event) => void) => void;
}

export type BrowserWebSocketFactory = (
  url: string,
  protocols?: string | string[],
) => BrowserWebSocketLike;

export interface BrowserWebSocketErrorDetail {
  operation: "close-socket" | "create-socket" | "send" | "socket-error" | "on-error";
  droppedEvents: number;
}

export interface BrowserWebSocketTransportOptions {
  url: string;
  name?: string;
  protocols?: string | string[];
  minLevel?: LoggerLevel;
  codec?: Codec<BrowserWebSocketPayload>;
  maxQueueSize?: number;
  dropPolicy?: BrowserWebSocketDropPolicy;
  webSocketFactory?: BrowserWebSocketFactory;
  closeCode?: number;
  closeReason?: string;
  onDrop?: (event: LogEvent, reason: string) => void;
  onError?: (error: unknown, detail: BrowserWebSocketErrorDetail) => void;
}

export interface BrowserWebSocketTransport extends Transport {
  queueSize: () => number;
}

interface QueueItem {
  events: readonly LogEvent[];
  payload: BrowserWebSocketPayload;
}

interface ActiveSocket {
  socket: BrowserWebSocketLike;
  onOpen: (event: Event) => void;
  onClose: (event: Event) => void;
  onError: (event: Event) => void;
}

const WS_CONNECTING = 0;
const WS_OPEN = 1;

function defaultWebSocketFactory(url: string, protocols?: string | string[]): BrowserWebSocketLike {
  if (typeof WebSocket === "undefined") {
    throw new Error("WebSocket is not available");
  }
  return new WebSocket(url, protocols);
}

function toSendPayload(payload: BrowserWebSocketPayload): BrowserWebSocketSendPayload {
  if (typeof payload === "string") return payload;
  return Uint8Array.from(payload);
}

export function browserWebSocketTransport(
  options: BrowserWebSocketTransportOptions,
): BrowserWebSocketTransport {
  const transportName = options.name ?? "browser-websocket";
  const codec = options.codec ?? safeJsonCodec();
  const maxQueueSize = options.maxQueueSize ?? 1000;
  const dropPolicy = options.dropPolicy ?? "drop-oldest";
  const webSocketFactory = options.webSocketFactory ?? defaultWebSocketFactory;
  const queue: QueueItem[] = [];
  let active: ActiveSocket | undefined;
  let closed = false;
  let lastContext: TransportContext | undefined;

  const reportDrop = (item: QueueItem, reason: string) => {
    incrementLoggerMetaCounter("transport.dropped", item.events.length);
    incrementLoggerMetaCounter(`transport.dropped.${reason}`, item.events.length);
    for (const event of item.events) options.onDrop?.(event, reason);
  };

  const reportError = (
    error: unknown,
    context: TransportContext | undefined,
    detail: BrowserWebSocketErrorDetail,
  ) => {
    try {
      options.onError?.(error, detail);
    } catch (onErrorError) {
      context?.reportInternalError(onErrorError, {
        operation: "on-error",
        phase: "transport",
        transport: transportName,
      });
    }

    context?.reportInternalError(error, {
      operation: detail.operation,
      phase: "transport",
      transport: transportName,
    });
  };

  const detachSocket = () => {
    if (!active) return;
    const current = active;
    current.socket.removeEventListener("open", current.onOpen);
    current.socket.removeEventListener("close", current.onClose);
    current.socket.removeEventListener("error", current.onError);
    active = undefined;
  };

  const drainQueue = (context = lastContext) => {
    const socket = active?.socket;
    if (!socket || socket.readyState !== WS_OPEN) return;

    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) return;
      try {
        socket.send(toSendPayload(item.payload));
      } catch (error) {
        reportDrop(item, "send");
        reportError(error, context, {
          droppedEvents: item.events.length,
          operation: "send",
        });
        return;
      }
    }
  };

  const createSocket = (context: TransportContext, droppedEvents: number) => {
    if (closed) return undefined;
    if (
      active &&
      (active.socket.readyState === WS_CONNECTING || active.socket.readyState === WS_OPEN)
    ) {
      return active.socket;
    }

    detachSocket();

    try {
      const socket = webSocketFactory(options.url, options.protocols);
      const nextActive: ActiveSocket = {
        socket,
        onOpen() {
          drainQueue(context);
        },
        onClose() {
          if (active?.socket === socket) detachSocket();
        },
        onError(errorEvent) {
          reportError(errorEvent, context, {
            droppedEvents: 0,
            operation: "socket-error",
          });
        },
      };
      active = nextActive;
      socket.addEventListener("open", nextActive.onOpen);
      socket.addEventListener("close", nextActive.onClose);
      socket.addEventListener("error", nextActive.onError);
      return socket;
    } catch (error) {
      reportError(error, context, {
        droppedEvents,
        operation: "create-socket",
      });
      return undefined;
    }
  };

  const enqueue = (item: QueueItem) => {
    if (queue.length >= maxQueueSize) {
      if (dropPolicy === "drop-newest") {
        reportDrop(item, "queue-full");
        return false;
      }

      const dropped = queue.shift();
      if (dropped) reportDrop(dropped, "queue-full");
    }

    queue.push(item);
    return true;
  };

  const sendOrQueue = (item: QueueItem, context: TransportContext) => {
    lastContext = context;
    if (closed) {
      reportDrop(item, "closed");
      return;
    }

    const socket = createSocket(context, item.events.length);
    if (!socket) {
      reportDrop(item, "create-socket");
      return;
    }

    if (socket.readyState === WS_OPEN) {
      try {
        socket.send(toSendPayload(item.payload));
      } catch (error) {
        reportDrop(item, "send");
        reportError(error, context, {
          droppedEvents: item.events.length,
          operation: "send",
        });
      }
      return;
    }

    enqueue(item);
  };

  return {
    name: transportName,
    minLevel: options.minLevel,
    queueSize() {
      return queue.length;
    },
    log(event, context) {
      sendOrQueue({ events: [event], payload: codec.encode(event) }, context);
    },
    logBatch(events, context) {
      if (events.length === 0) return;
      sendOrQueue({ events, payload: codec.encode(events) }, context);
    },
    flush() {
      drainQueue();
    },
    async close() {
      closed = true;
      while (queue.length > 0) {
        const item = queue.shift();
        if (item) reportDrop(item, "closed");
      }

      const socket = active?.socket;
      detachSocket();
      if (!socket) return;

      try {
        socket.close(options.closeCode, options.closeReason);
      } catch (error) {
        reportError(error, lastContext, {
          droppedEvents: 0,
          operation: "close-socket",
        });
      }
    },
  };
}
