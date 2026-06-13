import {
  incrementLoggerMetaCounter,
  type LogEvent,
  type LoggerLevel,
  type Transport,
  type TransportContext,
} from "@loggerjs/core";

export type BrowserServiceWorkerDropPolicy = "drop-oldest" | "drop-newest";
export type BrowserServiceWorkerTarget = "controller" | "ready";

export interface BrowserServiceWorkerLike {
  postMessage: (message: unknown, transfer?: Transferable[] | StructuredSerializeOptions) => void;
}

export interface BrowserServiceWorkerRegistrationLike {
  active?: BrowserServiceWorkerLike | null;
  waiting?: BrowserServiceWorkerLike | null;
  installing?: BrowserServiceWorkerLike | null;
}

export interface BrowserServiceWorkerContainerLike {
  controller?: BrowserServiceWorkerLike | null;
  ready?: Promise<BrowserServiceWorkerRegistrationLike>;
}

export interface BrowserServiceWorkerEventMessage {
  type: "loggerjs.event";
  source: string;
  event: LogEvent;
}

export interface BrowserServiceWorkerBatchMessage {
  type: "loggerjs.batch";
  source: string;
  events: readonly LogEvent[];
}

export type BrowserServiceWorkerMessage =
  | BrowserServiceWorkerEventMessage
  | BrowserServiceWorkerBatchMessage;

export interface BrowserServiceWorkerMapContext {
  source: string;
  target: BrowserServiceWorkerTarget;
}

export interface BrowserServiceWorkerTransportOptions {
  name?: string;
  minLevel?: LoggerLevel;
  source?: string;
  target?: BrowserServiceWorkerTarget;
  serviceWorker?: BrowserServiceWorkerContainerLike;
  maxQueueSize?: number;
  dropPolicy?: BrowserServiceWorkerDropPolicy;
  transfer?: (message: unknown) => Transferable[] | StructuredSerializeOptions | undefined;
  mapEvent?: (event: LogEvent, context: BrowserServiceWorkerMapContext) => unknown;
  mapBatch?: (events: readonly LogEvent[], context: BrowserServiceWorkerMapContext) => unknown;
  onDrop?: (event: LogEvent, reason: string) => void;
  onError?: (error: unknown, detail: { operation: string; droppedEvents: number }) => void;
}

interface QueueItem {
  events: readonly LogEvent[];
  message: unknown;
}

let sourceSequence = 0;

function createSourceId() {
  sourceSequence += 1;
  return `loggerjs-${Date.now().toString(36)}-${sourceSequence.toString(36)}`;
}

function defaultMapEvent(
  event: LogEvent,
  context: BrowserServiceWorkerMapContext,
): BrowserServiceWorkerEventMessage {
  return { type: "loggerjs.event", source: context.source, event };
}

function defaultMapBatch(
  events: readonly LogEvent[],
  context: BrowserServiceWorkerMapContext,
): BrowserServiceWorkerBatchMessage {
  return { type: "loggerjs.batch", source: context.source, events };
}

function serviceWorkerContainer(): BrowserServiceWorkerContainerLike | undefined {
  return typeof navigator === "undefined"
    ? undefined
    : (navigator.serviceWorker as unknown as BrowserServiceWorkerContainerLike);
}

function workerFromRegistration(registration: BrowserServiceWorkerRegistrationLike) {
  return registration.active ?? registration.waiting ?? registration.installing ?? undefined;
}

export function browserServiceWorkerTransport(
  options: BrowserServiceWorkerTransportOptions = {},
): Transport & { queueSize: () => number } {
  const transportName = options.name ?? "browser-service-worker";
  const target = options.target ?? "controller";
  const source = options.source ?? createSourceId();
  const maxQueueSize = options.maxQueueSize ?? 1000;
  const dropPolicy = options.dropPolicy ?? "drop-oldest";
  const mapContext: BrowserServiceWorkerMapContext = { source, target };
  const mapEvent = options.mapEvent ?? defaultMapEvent;
  const mapBatch = options.mapBatch ?? defaultMapBatch;
  const queue: QueueItem[] = [];
  let readyWorker: BrowserServiceWorkerLike | undefined;
  let readyPromise: Promise<void> | undefined;
  let lastContext: TransportContext | undefined;

  const reportError = (
    error: unknown,
    context: TransportContext | undefined,
    operation: string,
    droppedEvents = 0,
  ) => {
    try {
      options.onError?.(error, { droppedEvents, operation });
    } catch (onErrorError) {
      context?.reportInternalError(onErrorError, {
        operation: "on-error",
        phase: "transport",
        transport: transportName,
      });
    }
    context?.reportInternalError(error, {
      operation,
      phase: "transport",
      transport: transportName,
    });
  };

  const reportDrop = (item: QueueItem, reason: string) => {
    incrementLoggerMetaCounter("transport.dropped", item.events.length);
    incrementLoggerMetaCounter(`transport.dropped.${reason}`, item.events.length);
    for (const event of item.events) options.onDrop?.(event, reason);
  };

  const currentWorker = () => {
    const container = options.serviceWorker ?? serviceWorkerContainer();
    if (!container) return undefined;
    if (target === "controller") return container.controller ?? undefined;
    return readyWorker;
  };

  const post = (worker: BrowserServiceWorkerLike, item: QueueItem, context: TransportContext) => {
    try {
      worker.postMessage(item.message, options.transfer?.(item.message));
      return true;
    } catch (error) {
      reportDrop(item, "post-message");
      reportError(error, context, "post-message", item.events.length);
      return false;
    }
  };

  const drain = (context = lastContext) => {
    const worker = currentWorker();
    if (!worker || !context) return;
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) return;
      post(worker, item, context);
    }
  };

  const dropQueued = (reason: string) => {
    const pending = queue.splice(0);
    for (const item of pending) reportDrop(item, reason);
    return pending.reduce((total, item) => total + item.events.length, 0);
  };

  const waitForReady = (context?: TransportContext) => {
    const worker = currentWorker();
    if (worker) return Promise.resolve();
    if (target !== "ready") {
      return Promise.reject(new Error("service worker controller is not available"));
    }
    if (readyPromise) return readyPromise;
    const container = options.serviceWorker ?? serviceWorkerContainer();
    if (!container?.ready) {
      const error = new Error("serviceWorker.ready is not available");
      const droppedEvents = dropQueued("ready");
      reportError(error, context, "ready", droppedEvents);
      return Promise.reject(error);
    }
    readyPromise = container.ready
      .then((registration) => {
        readyWorker = workerFromRegistration(registration);
        if (!readyWorker) {
          throw new Error("service worker registration has no active worker");
        }
        drain(context ?? lastContext);
      })
      .catch((error) => {
        readyPromise = undefined;
        const droppedEvents = dropQueued("ready");
        reportError(error, context ?? lastContext, "ready", droppedEvents);
        throw error;
      });
    return readyPromise;
  };

  const startReady = (context: TransportContext) => {
    void waitForReady(context).catch(() => {
      // Errors are already reported through the transport context.
    });
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

  const send = (item: QueueItem, context: TransportContext) => {
    lastContext = context;
    const worker = currentWorker();
    if (worker) {
      post(worker, item, context);
      return;
    }
    if (target === "ready") {
      if (enqueue(item)) startReady(context);
      return;
    }
    reportDrop(item, "unavailable");
    reportError(
      new Error("service worker controller is not available"),
      context,
      "unavailable",
      item.events.length,
    );
  };

  return {
    name: transportName,
    minLevel: options.minLevel,
    queueSize() {
      return queue.length;
    },
    ready() {
      return waitForReady();
    },
    log(event, context) {
      send({ events: [event], message: mapEvent(event, mapContext) }, context);
    },
    logBatch(events, context) {
      if (events.length === 0) return;
      send({ events, message: mapBatch(events, mapContext) }, context);
    },
    flush() {
      drain();
    },
    close() {
      const pending = queue.splice(0);
      for (const item of pending) reportDrop(item, "closed");
    },
  };
}
