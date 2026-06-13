import { Worker } from "node:worker_threads";
import {
  emitLoggerDiagnostic,
  incrementLoggerMetaCounter,
  safeJsonCodec,
  setLoggerMetaGauge,
  toLevelValue,
  type Codec,
  type LogEvent,
  type LoggerLevel,
  type Transport,
  type TransportContext,
} from "@loggerjs/core";

export interface WorkerLike {
  postMessage: (value: unknown, transferList?: ArrayBuffer[]) => void;
  terminate?: () => void | number | Promise<number>;
  on?: (event: "error" | "exit" | "message", listener: (...args: unknown[]) => void) => unknown;
  off?: (event: "error" | "exit" | "message", listener: (...args: unknown[]) => void) => unknown;
}

export interface WorkerTransportMessage {
  type: "loggerjs:batch";
  id?: number;
  codec: string;
  contentType: string;
  count: number;
  payload: Uint8Array;
}

export type WorkerTransportProtocolMessage =
  | { type: "loggerjs:ready" }
  | { type: "loggerjs:batch:ack"; id: number }
  | { type: "loggerjs:error"; error?: unknown; message?: string };

export interface WorkerTransportOptions {
  name?: string;
  worker?: WorkerLike;
  workerFactory?: () => WorkerLike;
  workerScript?: string | URL;
  workerOptions?: object;
  fallback?: Transport;
  codec?: Codec<string | Uint8Array>;
  minLevel?: LoggerLevel;
  transferBuffers?: boolean;
  readyTimeoutMs?: number;
  ackTimeoutMs?: number;
  autoEnd?: boolean;
}

interface PendingBatch {
  id: number;
  events: LogEvent[];
  context: TransportContext;
  timer?: ReturnType<typeof setTimeout>;
  resolve: () => void;
}

function createDefaultWorker(options: WorkerTransportOptions): WorkerLike {
  if (!options.workerScript) {
    throw new Error("workerTransport requires worker, workerFactory, or workerScript.");
  }
  return new Worker(options.workerScript, options.workerOptions);
}

function payloadToBytes(payload: string | Uint8Array): Uint8Array {
  if (typeof payload !== "string") return payload;
  return new TextEncoder().encode(payload);
}

function transferablePayload(payload: Uint8Array): {
  payload: Uint8Array;
  transferList?: ArrayBuffer[];
} {
  const copy = Uint8Array.from(payload);
  return {
    payload: copy,
    transferList: [copy.buffer],
  };
}

function normalizePositiveTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function protocolMessage(value: unknown): WorkerTransportProtocolMessage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const message = value as { type?: unknown };
  if (message.type === "loggerjs:ready") return { type: "loggerjs:ready" };
  if (message.type === "loggerjs:batch:ack") {
    const id = (value as { id?: unknown }).id;
    if (typeof id === "number") return { type: "loggerjs:batch:ack", id };
  }
  if (message.type === "loggerjs:error") {
    const item = value as { error?: unknown; message?: unknown };
    return {
      type: "loggerjs:error",
      error: item.error,
      message: typeof item.message === "string" ? item.message : undefined,
    };
  }
  return undefined;
}

function dropBatch(events: LogEvent[], reason: string) {
  incrementLoggerMetaCounter("transport.dropped", events.length);
  incrementLoggerMetaCounter(`transport.dropped.${reason}`, events.length);
}

export function workerTransport(options: WorkerTransportOptions = {}): Transport {
  const codec = options.codec ?? safeJsonCodec();
  const transportName = options.name ?? "worker";
  const fallback = options.fallback;
  const readyTimeoutMs = normalizePositiveTimeout(options.readyTimeoutMs);
  const ackTimeoutMs = normalizePositiveTimeout(options.ackTimeoutMs);
  const autoEnd = options.autoEnd ?? true;
  let worker: WorkerLike | undefined;
  let failed = false;
  let lastContext: TransportContext | undefined;
  let ready = readyTimeoutMs === 0;
  let readyPromise: Promise<void> | undefined;
  let readyTimer: ReturnType<typeof setTimeout> | undefined;
  let readyResolve: (() => void) | undefined;
  let readyReject: ((error: Error) => void) | undefined;
  let nextBatchId = 1;
  const pendingBatches = new Map<number, PendingBatch>();

  const setPendingGauge = () => {
    setLoggerMetaGauge(`transport.queue.depth.${transportName}`, pendingBatches.size);
  };

  const setReadyGauge = (value: number) => {
    setLoggerMetaGauge(`transport.ready.${transportName}`, value);
  };

  const reportInternalError = (error: unknown, operation: string) => {
    lastContext?.reportInternalError(error, {
      phase: "transport",
      transport: transportName,
      operation,
    });
  };

  const markFailed = (error: unknown, operation: string) => {
    if (failed) return;
    failed = true;
    setReadyGauge(0);
    incrementLoggerMetaCounter("transport.worker.failed");
    emitLoggerDiagnostic({
      stage: "worker",
      phase: "error",
      transport: transportName,
      operation,
      error,
    });
    reportInternalError(error, operation);
    readyReject?.(error instanceof Error ? error : new Error(String(error)));
    failPendingBatches(operation);
  };

  const onWorkerError = (error: unknown) => markFailed(error, "worker-error");
  const onWorkerExit = (code: unknown) => {
    if (typeof code === "number" && code !== 0) markFailed(code, "worker-exit");
  };
  const onWorkerMessage = (value: unknown) => {
    const message = protocolMessage(value);
    if (!message) return;
    if (message.type === "loggerjs:ready") {
      ready = true;
      setReadyGauge(1);
      emitLoggerDiagnostic({
        stage: "worker",
        phase: "end",
        transport: transportName,
        operation: "ready",
      });
      if (readyTimer) clearTimeout(readyTimer);
      readyResolve?.();
      return;
    }
    if (message.type === "loggerjs:batch:ack") {
      const pending = pendingBatches.get(message.id);
      if (!pending) return;
      pendingBatches.delete(message.id);
      setPendingGauge();
      if (pending.timer) clearTimeout(pending.timer);
      pending.resolve();
      incrementLoggerMetaCounter("transport.worker.ack");
      return;
    }
    markFailed(
      message.error ?? new Error(message.message ?? "Worker reported an error"),
      "worker-message",
    );
  };

  const fallbackOrDropBatch = async (
    events: LogEvent[],
    context: TransportContext,
    reason: string,
  ) => {
    if (fallback) {
      await fallbackBatch(events, context);
      return;
    }
    dropBatch(events, reason);
  };

  const failPendingBatch = (pending: PendingBatch, reason: string) => {
    pendingBatches.delete(pending.id);
    setPendingGauge();
    if (pending.timer) clearTimeout(pending.timer);
    incrementLoggerMetaCounter("transport.worker.pending-dropped", pending.events.length);
    void fallbackOrDropBatch(pending.events, pending.context, reason).finally(pending.resolve);
  };

  function failPendingBatches(reason: string) {
    for (const pending of Array.from(pendingBatches.values())) failPendingBatch(pending, reason);
  }

  const waitForReady = async () => {
    if (ready) return;
    readyPromise ??= new Promise<void>((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
      readyTimer = setTimeout(() => {
        reject(new Error(`workerTransport ready timeout after ${readyTimeoutMs}ms`));
      }, readyTimeoutMs);
    });
    await readyPromise;
  };

  const getWorker = (): WorkerLike | undefined => {
    if (failed) return undefined;
    if (worker) return worker;
    try {
      worker = options.worker ?? options.workerFactory?.() ?? createDefaultWorker(options);
      worker.on?.("error", onWorkerError);
      worker.on?.("exit", onWorkerExit);
      worker.on?.("message", onWorkerMessage);
      if (ready) setReadyGauge(1);
      return worker;
    } catch (error) {
      markFailed(error, "create-worker");
      return undefined;
    }
  };

  const fallbackBatch = async (events: LogEvent[], context: TransportContext) => {
    if (fallback?.logBatch) {
      await fallback.logBatch(events, context);
      return;
    }
    if (fallback?.log) {
      for (const event of events) {
        // oxlint-disable-next-line no-await-in-loop -- Fallback should preserve log order.
        await fallback.log(event, context);
      }
    }
  };

  const postBatch = async (events: LogEvent[], context: TransportContext) => {
    lastContext = context;
    const currentWorker = getWorker();
    if (!currentWorker) {
      await fallbackOrDropBatch(events, context, "worker-unavailable");
      return;
    }
    try {
      await waitForReady();
    } catch (error) {
      markFailed(error, "worker-ready-timeout");
      await fallbackOrDropBatch(events, context, "worker-ready-timeout");
      return;
    }

    const encoded = payloadToBytes(codec.encode(events));
    const transferable =
      options.transferBuffers === false
        ? { payload: encoded, transferList: undefined }
        : transferablePayload(encoded);
    const message: WorkerTransportMessage = {
      type: "loggerjs:batch",
      codec: codec.name,
      contentType: codec.contentType,
      count: events.length,
      payload: transferable.payload,
    };
    let pending: PendingBatch | undefined;
    if (ackTimeoutMs > 0) {
      const id = nextBatchId;
      nextBatchId += 1;
      message.id = id;
      pending = { id, events, context, resolve: () => {} };
      pending.timer = setTimeout(() => {
        if (!pending) return;
        markFailed(
          new Error(`workerTransport ack timeout after ${ackTimeoutMs}ms`),
          "worker-ack-timeout",
        );
      }, ackTimeoutMs);
      pendingBatches.set(id, pending);
      setPendingGauge();
    }

    try {
      currentWorker.postMessage(message, transferable.transferList);
    } catch (error) {
      markFailed(error, "post-message");
      if (!pending) await fallbackOrDropBatch(events, context, "worker-post-message");
    }
  };

  const transport: Transport = {
    name: transportName,
    minLevel: options.minLevel,
    log(event, context) {
      if (options.minLevel !== undefined && event.level < toLevelValue(options.minLevel)) return;
      return postBatch([event], context);
    },
    logBatch(events, context) {
      return postBatch(events, context);
    },
    async flush() {
      await Promise.all(
        Array.from(
          pendingBatches.values(),
          (pending) =>
            new Promise<void>((resolve) => {
              const originalResolve = pending.resolve;
              pending.resolve = () => {
                originalResolve();
                resolve();
              };
            }),
        ),
      );
      await fallback?.flush?.();
    },
    async close() {
      worker?.off?.("error", onWorkerError);
      worker?.off?.("exit", onWorkerExit);
      worker?.off?.("message", onWorkerMessage);
      await transport.flush?.();
      await fallback?.close?.();
      if (autoEnd) await worker?.terminate?.();
      if (readyTimer) clearTimeout(readyTimer);
      readyReject = undefined;
      readyResolve = undefined;
    },
  };
  return transport;
}
