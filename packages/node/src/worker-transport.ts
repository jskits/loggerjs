import { Worker } from "node:worker_threads";
import {
  incrementLoggerMetaCounter,
  safeJsonCodec,
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
  on?: (event: "error" | "exit", listener: (...args: unknown[]) => void) => unknown;
  off?: (event: "error" | "exit", listener: (...args: unknown[]) => void) => unknown;
}

export interface WorkerTransportMessage {
  type: "loggerjs:batch";
  codec: string;
  contentType: string;
  count: number;
  payload: Uint8Array;
}

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

export function workerTransport(options: WorkerTransportOptions = {}): Transport {
  const codec = options.codec ?? safeJsonCodec();
  const transportName = options.name ?? "worker";
  const fallback = options.fallback;
  let worker: WorkerLike | undefined;
  let failed = false;
  let lastContext: TransportContext | undefined;

  const reportInternalError = (error: unknown, operation: string) => {
    lastContext?.reportInternalError(error, {
      phase: "transport",
      transport: transportName,
      operation,
    });
  };

  const markFailed = (error: unknown, operation: string) => {
    failed = true;
    incrementLoggerMetaCounter("transport.worker.failed");
    reportInternalError(error, operation);
  };

  const onWorkerError = (error: unknown) => markFailed(error, "worker-error");
  const onWorkerExit = (code: unknown) => {
    if (typeof code === "number" && code !== 0) markFailed(code, "worker-exit");
  };

  const getWorker = (): WorkerLike | undefined => {
    if (failed) return undefined;
    if (worker) return worker;
    try {
      worker = options.worker ?? options.workerFactory?.() ?? createDefaultWorker(options);
      worker.on?.("error", onWorkerError);
      worker.on?.("exit", onWorkerExit);
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
      await fallbackBatch(events, context);
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

    try {
      currentWorker.postMessage(message, transferable.transferList);
    } catch (error) {
      markFailed(error, "post-message");
      await fallbackBatch(events, context);
    }
  };

  return {
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
      await fallback?.flush?.();
    },
    async close() {
      worker?.off?.("error", onWorkerError);
      worker?.off?.("exit", onWorkerExit);
      await fallback?.close?.();
      await worker?.terminate?.();
    },
  };
}
