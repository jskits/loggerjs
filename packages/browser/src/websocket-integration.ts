import {
  normalizeValue,
  type CaptureInput,
  type Integration,
  type IntegrationSetupContext,
  type LoggerLevel,
} from "@loggerjs/core";
import { durationMs, nowMs, sanitizeHttpUrl, shouldSample } from "./http-capture-utils";

type BrowserWebSocketSendPayload = Parameters<WebSocket["send"]>[0];

export interface BrowserCapturedWebSocketLike {
  url?: string;
  send?: (data: BrowserWebSocketSendPayload) => void;
  close?: (code?: number, reason?: string) => void;
  addEventListener?: (type: string, listener: EventListenerOrEventListenerObject) => void;
  removeEventListener?: (type: string, listener: EventListenerOrEventListenerObject) => void;
}

export interface BrowserCapturedWebSocketConstructor {
  new (url: string | URL, protocols?: string | string[]): BrowserCapturedWebSocketLike;
  prototype?: unknown;
  CONNECTING?: number;
  OPEN?: number;
  CLOSING?: number;
  CLOSED?: number;
}

export type BrowserWebSocketDirection = "incoming" | "outgoing";

export interface BrowserWebSocketMessagePayload {
  direction: BrowserWebSocketDirection;
  dataType: string;
  byteLength?: number;
  data?: unknown;
}

export interface CaptureWebSocketOptions {
  level?: LoggerLevel;
  captureConnect?: boolean;
  captureOpen?: boolean;
  captureClose?: boolean;
  captureError?: boolean;
  captureMessages?: boolean;
  captureSentMessages?: boolean;
  captureMessageData?: boolean;
  sampleRate?: number;
  random?: () => number;
  sanitizeUrl?: (url: string) => string;
  WebSocket?: BrowserCapturedWebSocketConstructor;
}

const registryKey = "browser.WebSocket";
const textEncoder = new TextEncoder();

function dataType(data: unknown): string {
  if (typeof data === "string") return "string";
  if (data instanceof ArrayBuffer) return "arraybuffer";
  if (ArrayBuffer.isView(data)) return data.constructor.name;
  const record = data as { constructor?: { name?: string } } | undefined;
  return record?.constructor?.name ?? typeof data;
}

function dataByteLength(data: unknown): number | undefined {
  if (typeof data === "string") return textEncoder.encode(data).byteLength;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  const size = (data as { size?: unknown } | undefined)?.size;
  return typeof size === "number" && Number.isFinite(size) ? size : undefined;
}

function messagePayload(
  direction: BrowserWebSocketDirection,
  data: unknown,
  captureMessageData: boolean,
): BrowserWebSocketMessagePayload {
  return {
    direction,
    dataType: dataType(data),
    byteLength: dataByteLength(data),
    data: captureMessageData ? normalizeValue(data, { maxDepth: 4, maxObjectKeys: 80 }) : undefined,
  };
}

function closeEventPayload(event: Event): Record<string, unknown> {
  const close = event as CloseEvent;
  return {
    code: close.code,
    reason: close.reason,
    wasClean: close.wasClean,
  };
}

function copyStaticConstants(
  target: BrowserCapturedWebSocketConstructor,
  source: BrowserCapturedWebSocketConstructor,
) {
  for (const key of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"] as const) {
    if (source[key] !== undefined) target[key] = source[key];
  }
}

export function captureWebSocketIntegration(options: CaptureWebSocketOptions = {}): Integration {
  const level = options.level ?? "debug";
  const captureConnect = options.captureConnect ?? true;
  const captureOpen = options.captureOpen ?? true;
  const captureClose = options.captureClose ?? true;
  const captureError = options.captureError ?? true;
  const captureMessages = options.captureMessages ?? false;
  const captureSentMessages = options.captureSentMessages ?? false;
  const captureMessageData = options.captureMessageData ?? false;
  const sampleRate = options.sampleRate ?? 1;
  const random = options.random ?? Math.random;

  return {
    name: "capture-websocket",
    setup(api: IntegrationSetupContext) {
      const globalWebSocket = globalThis.WebSocket as
        | BrowserCapturedWebSocketConstructor
        | undefined;
      const current = options.WebSocket ?? globalWebSocket;
      if (!current) return;
      const original =
        api.unpatched.get<BrowserCapturedWebSocketConstructor>(registryKey) ?? current;
      api.unpatched.set(registryKey, original);
      const capture = api.guard((input: CaptureInput) => api.capture(input));

      const PatchedWebSocket = function WebSocket(
        this: BrowserCapturedWebSocketLike,
        url: string | URL,
        protocols?: string | string[],
      ) {
        const started = nowMs();
        const sanitizedUrl = sanitizeHttpUrl(String(url), options.sanitizeUrl);
        const socket = new original(url, protocols);

        const captureLifecycle = (
          event: "close" | "connect" | "error" | "open",
          extra: Record<string, unknown> = {},
          error?: unknown,
        ) => {
          if (!shouldSample(sampleRate, random)) return;
          capture({
            level: event === "error" ? "error" : level,
            message: `WebSocket ${event} ${sanitizedUrl}`,
            error,
            props: {
              websocket: {
                kind: "websocket",
                event,
                url: sanitizedUrl,
                durationMs: durationMs(started),
                ...extra,
              },
            },
          });
        };

        if (captureConnect) captureLifecycle("connect");

        if (captureOpen) {
          socket.addEventListener?.("open", () => captureLifecycle("open"));
        }
        if (captureClose) {
          socket.addEventListener?.("close", (event) =>
            captureLifecycle("close", closeEventPayload(event)),
          );
        }
        if (captureError) {
          socket.addEventListener?.("error", (event) =>
            captureLifecycle("error", { type: event.type }, event),
          );
        }
        if (captureMessages) {
          socket.addEventListener?.("message", (event) => {
            const message = event as MessageEvent;
            capture({
              level,
              message: `WebSocket message ${sanitizedUrl}`,
              props: {
                websocket: {
                  kind: "websocket-message",
                  url: sanitizedUrl,
                  message: messagePayload("incoming", message.data, captureMessageData),
                },
              },
            });
          });
        }

        if (captureSentMessages && socket.send) {
          const originalSend = socket.send.bind(socket);
          socket.send = (data: BrowserWebSocketSendPayload) => {
            capture({
              level,
              message: `WebSocket send ${sanitizedUrl}`,
              props: {
                websocket: {
                  kind: "websocket-message",
                  url: sanitizedUrl,
                  message: messagePayload("outgoing", data, captureMessageData),
                },
              },
            });
            return originalSend(data);
          };
        }

        return socket;
      } as unknown as BrowserCapturedWebSocketConstructor;

      PatchedWebSocket.prototype = original.prototype;
      copyStaticConstants(PatchedWebSocket, original);
      globalThis.WebSocket = PatchedWebSocket as unknown as typeof WebSocket;

      return () => {
        globalThis.WebSocket = current as unknown as typeof WebSocket;
      };
    },
  };
}
