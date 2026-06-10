import {
  normalizeValue,
  type Integration,
  type IntegrationSetupContext,
  type LoggerLevel,
} from "@loggerjs/core";

export interface BrowserServiceWorkerControllerLike {
  scriptURL?: string;
  state?: string;
}

export interface BrowserServiceWorkerContainerEventsLike {
  controller?: BrowserServiceWorkerControllerLike | null;
  addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
  removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
}

export interface BrowserServiceWorkerMessagePayload {
  dataType: string;
  byteLength?: number;
  data?: unknown;
  origin?: string;
  lastEventId?: string;
}

export interface CaptureServiceWorkerOptions {
  level?: LoggerLevel;
  captureControllerChange?: boolean;
  captureMessages?: boolean;
  captureMessageErrors?: boolean;
  captureMessageData?: boolean;
  serviceWorker?: BrowserServiceWorkerContainerEventsLike;
  sanitizeUrl?: (url: string) => string;
}

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

function controllerInfo(
  controller: BrowserServiceWorkerControllerLike | null | undefined,
  sanitizeUrl: ((url: string) => string) | undefined,
) {
  if (!controller) return undefined;
  return {
    scriptURL:
      controller.scriptURL && sanitizeUrl
        ? sanitizeUrl(controller.scriptURL)
        : controller.scriptURL,
    state: controller.state,
  };
}

function messagePayload(
  event: MessageEvent,
  captureMessageData: boolean,
): BrowserServiceWorkerMessagePayload {
  return {
    dataType: dataType(event.data),
    byteLength: dataByteLength(event.data),
    data: captureMessageData
      ? normalizeValue(event.data, { maxDepth: 4, maxObjectKeys: 80 })
      : undefined,
    origin: event.origin,
    lastEventId: event.lastEventId,
  };
}

export function captureServiceWorkerIntegration(
  options: CaptureServiceWorkerOptions = {},
): Integration {
  const level = options.level ?? "debug";
  const captureControllerChange = options.captureControllerChange ?? true;
  const captureMessages = options.captureMessages ?? true;
  const captureMessageErrors = options.captureMessageErrors ?? true;
  const captureMessageData = options.captureMessageData ?? false;

  return {
    name: "capture-service-worker",
    setup(api: IntegrationSetupContext) {
      const serviceWorker =
        options.serviceWorker ??
        (typeof navigator === "undefined" ? undefined : navigator.serviceWorker);
      if (!serviceWorker?.addEventListener || !serviceWorker.removeEventListener) return;
      const disposers: Array<() => void> = [];
      let disposed = false;

      const capture = api.guard((input: Parameters<IntegrationSetupContext["capture"]>[0]) => {
        if (!disposed) api.capture(input);
      });

      if (captureControllerChange) {
        const onControllerChange = () => {
          capture({
            level,
            message: "Service worker controller change",
            props: {
              browser: {
                kind: "service-worker",
                event: "controllerchange",
                controller: controllerInfo(serviceWorker.controller, options.sanitizeUrl),
              },
            },
          });
        };
        serviceWorker.addEventListener("controllerchange", onControllerChange);
        disposers.push(() =>
          serviceWorker.removeEventListener("controllerchange", onControllerChange),
        );
      }

      if (captureMessages) {
        const onMessage = (event: Event) => {
          const message = event as MessageEvent;
          capture({
            level,
            message: "Service worker message",
            props: {
              browser: {
                kind: "service-worker",
                event: "message",
                message: messagePayload(message, captureMessageData),
              },
            },
          });
        };
        serviceWorker.addEventListener("message", onMessage);
        disposers.push(() => serviceWorker.removeEventListener("message", onMessage));
      }

      if (captureMessageErrors) {
        const onMessageError = (event: Event) => {
          capture({
            level: "warn",
            message: "Service worker message error",
            props: {
              browser: {
                kind: "service-worker",
                event: "messageerror",
                type: event.type,
              },
            },
          });
        };
        serviceWorker.addEventListener("messageerror", onMessageError);
        disposers.push(() => serviceWorker.removeEventListener("messageerror", onMessageError));
      }

      return () => {
        if (disposed) return;
        disposed = true;
        for (const dispose of disposers) dispose();
      };
    },
  };
}
