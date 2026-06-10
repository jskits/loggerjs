import {
  ndjsonCodec,
  toLevelValue,
  type Codec,
  type LogEvent,
  type LoggerLevel,
  type Transport,
  type TransportContext,
} from "@loggerjs/core";
import type { WritableLike } from "./internal-types";

export interface StdoutTransportOptions {
  name?: string;
  stream?: WritableLike;
  codec?: Codec<string | Uint8Array>;
  minLevel?: LoggerLevel;
}

interface FlushWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
}

const normalizeError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

export function stdoutTransport(options: StdoutTransportOptions = {}): Transport {
  const codec = options.codec ?? ndjsonCodec();
  const stream = options.stream ?? process.stdout;
  const transportName = options.name ?? "stdout";
  const waiters: FlushWaiter[] = [];
  let pendingWrites = 0;
  let pendingDrains = 0;
  let lastError: Error | undefined;
  let lastContext: TransportContext | undefined;

  const reportInternalError = (error: unknown, operation: string) => {
    lastContext?.reportInternalError(error, {
      phase: "transport",
      transport: transportName,
      operation,
    });
  };

  const settleWaitersIfIdle = () => {
    if (pendingWrites + pendingDrains > 0) return;
    const error = lastError;
    lastError = undefined;
    for (const waiter of waiters.splice(0)) {
      if (error) waiter.reject(error);
      else waiter.resolve();
    }
  };

  const recordError = (error: unknown, operation: string) => {
    lastError = normalizeError(error);
    reportInternalError(lastError, operation);
  };

  const waitForDrain = () => {
    if (!stream.once) return;
    pendingDrains += 1;
    stream.once("drain", () => {
      pendingDrains -= 1;
      settleWaitersIfIdle();
    });
  };

  const writePayload = (payload: string | Uint8Array) => {
    pendingWrites += 1;
    try {
      const result = stream.write(payload, (error?: Error | null) => {
        pendingWrites -= 1;
        if (error) recordError(error, "write");
        settleWaitersIfIdle();
      });
      if (result === false) waitForDrain();
    } catch (error) {
      pendingWrites -= 1;
      recordError(error, "write");
      settleWaitersIfIdle();
    }
  };

  return {
    name: transportName,
    minLevel: options.minLevel,
    log(event: LogEvent, context) {
      if (options.minLevel !== undefined && event.level < toLevelValue(options.minLevel)) return;
      lastContext = context;
      writePayload(codec.encode(event));
    },
    flush() {
      if (pendingWrites + pendingDrains === 0) {
        const error = lastError;
        lastError = undefined;
        if (error) return Promise.reject(error);
        return Promise.resolve();
      }
      return new Promise<void>((resolve, reject) => {
        waiters.push({ resolve, reject });
      });
    },
  };
}

export function stderrTransport(options: Omit<StdoutTransportOptions, "stream"> = {}): Transport {
  return stdoutTransport({ ...options, name: options.name ?? "stderr", stream: process.stderr });
}
