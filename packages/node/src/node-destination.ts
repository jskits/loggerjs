import { closeSync, createWriteStream, mkdirSync, openSync, writeSync, type WriteStream } from "fs";
import { dirname } from "path";
import type { TransportContext } from "@loggerjs/core";
import type { WritableLike } from "./internal-types";

export interface NodeDestination {
  stream?: WriteStream;
  write: (payload: string | Uint8Array, context?: TransportContext) => void;
  flush: () => Promise<void>;
  flushSync: () => void;
  close: () => Promise<void>;
  closeSync: () => void;
  releaseSync?: () => void;
}

export interface NodeStreamDestinationOptions {
  name: string;
  stream: WritableLike;
  minLength?: number;
  ignoreEpipe?: boolean;
  reportOperation?: string;
  syncWrite?: (payload: string | Uint8Array) => void;
}

export interface NodeFileDestinationOptions {
  name: string;
  path: string;
  flags?: string;
  append?: boolean;
  mkdir?: boolean;
  sync?: boolean;
  minLength?: number;
}

interface FlushWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
}

const encoder = new TextEncoder();

const normalizeError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

function byteLength(payload: string | Uint8Array): number {
  return typeof payload === "string" ? encoder.encode(payload).byteLength : payload.byteLength;
}

function coalescePayloads(payloads: Array<string | Uint8Array>): string | Uint8Array {
  if (payloads.every((payload) => typeof payload === "string")) {
    return payloads.join("");
  }
  const buffers = payloads.map((payload) =>
    typeof payload === "string" ? Buffer.from(payload) : Buffer.from(payload),
  );
  return Buffer.concat(buffers);
}

function isEpipe(error: unknown): boolean {
  return (
    Boolean(error) && typeof error === "object" && (error as { code?: unknown }).code === "EPIPE"
  );
}

function normalizeMinLength(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

export function createNodeStreamDestination(
  options: NodeStreamDestinationOptions,
): NodeDestination {
  const minLength = normalizeMinLength(options.minLength);
  const ignoreEpipe = options.ignoreEpipe ?? false;
  const waiters: FlushWaiter[] = [];
  const buffer: Array<string | Uint8Array> = [];
  const pendingPayloads: Array<string | Uint8Array> = [];
  let bufferedBytes = 0;
  let pendingWrites = 0;
  let pendingDrains = 0;
  let lastError: Error | undefined;
  let lastContext: TransportContext | undefined;
  let closed = false;

  const reportInternalError = (error: unknown, operation: string) => {
    if (ignoreEpipe && isEpipe(error)) return;
    lastContext?.reportInternalError(error, {
      phase: "transport",
      transport: options.name,
      operation,
    });
  };

  const settleWaitersIfIdle = () => {
    if (pendingWrites + pendingDrains > 0) return;
    if (waiters.length === 0) return;
    const error = lastError;
    lastError = undefined;
    for (const waiter of waiters.splice(0)) {
      if (error) waiter.reject(error);
      else waiter.resolve();
    }
  };

  const recordError = (error: unknown, operation: string) => {
    if (ignoreEpipe && isEpipe(error)) {
      closed = true;
      return;
    }
    lastError = normalizeError(error);
    reportInternalError(lastError, operation);
  };

  const onStreamError = (error: Error) => {
    recordError(error, "stream-error");
    settleWaitersIfIdle();
  };
  const offError = () => options.stream.off?.("error", onStreamError);
  options.stream.on?.("error", onStreamError);

  const waitForDrain = () => {
    if (!options.stream.once) return;
    pendingDrains += 1;
    options.stream.once("drain", () => {
      pendingDrains -= 1;
      settleWaitersIfIdle();
    });
  };

  const removePending = (payload: string | Uint8Array) => {
    const index = pendingPayloads.indexOf(payload);
    if (index >= 0) pendingPayloads.splice(index, 1);
  };

  const writeNow = (payload: string | Uint8Array) => {
    if (closed) return;
    pendingPayloads.push(payload);
    pendingWrites += 1;
    try {
      const result = options.stream.write(payload, (error?: Error | null) => {
        removePending(payload);
        pendingWrites -= 1;
        if (error) recordError(error, options.reportOperation ?? "write");
        settleWaitersIfIdle();
      });
      if (result === false) waitForDrain();
    } catch (error) {
      removePending(payload);
      pendingWrites -= 1;
      recordError(error, options.reportOperation ?? "write");
      settleWaitersIfIdle();
    }
  };

  const flushBuffered = () => {
    if (buffer.length === 0) return;
    const payload = coalescePayloads(buffer.splice(0));
    bufferedBytes = 0;
    writeNow(payload);
  };

  const destination: NodeDestination = {
    write(payload, context) {
      if (closed) return;
      lastContext = context;
      if (minLength > 0) {
        buffer.push(payload);
        bufferedBytes += byteLength(payload);
        if (bufferedBytes >= minLength) flushBuffered();
        return;
      }
      writeNow(payload);
    },
    flush() {
      flushBuffered();
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
    flushSync() {
      if (!options.syncWrite) {
        flushBuffered();
        return;
      }
      for (const payload of buffer.splice(0)) options.syncWrite(payload);
      bufferedBytes = 0;
      for (const payload of pendingPayloads.splice(0)) options.syncWrite(payload);
    },
    close() {
      return destination.flush().then(
        () =>
          new Promise<void>((resolve, reject) => {
            if (!options.stream.end) {
              closed = true;
              offError();
              resolve();
              return;
            }
            options.stream.end((error?: Error | null) => {
              closed = true;
              offError();
              if (error && !(ignoreEpipe && isEpipe(error))) reject(error);
              else resolve();
            });
          }),
        (error: unknown) => {
          offError();
          return Promise.reject(error);
        },
      );
    },
    closeSync() {
      destination.flushSync();
      closed = true;
      offError();
    },
  };
  return destination;
}

export function createNodeFileDestination(options: NodeFileDestinationOptions): NodeDestination {
  const flags = options.flags ?? (options.append === false ? "w" : "a");
  if (options.mkdir) mkdirSync(dirname(options.path), { recursive: true });

  let fd: number | undefined;
  const getFd = () => {
    fd ??= openSync(options.path, flags);
    return fd;
  };
  const syncWrite = (payload: string | Uint8Array) => {
    if (typeof payload === "string") writeSync(getFd(), payload);
    else writeSync(getFd(), payload);
  };

  if (options.sync) {
    let closed = false;
    const releaseSync = () => {
      if (fd !== undefined) {
        closeSync(fd);
        fd = undefined;
      }
    };
    return {
      write(payload) {
        if (closed) return;
        syncWrite(payload);
      },
      flush() {
        return Promise.resolve();
      },
      flushSync() {},
      close() {
        releaseSync();
        closed = true;
        return Promise.resolve();
      },
      closeSync() {
        releaseSync();
        closed = true;
      },
      releaseSync,
    };
  }

  const stream = createWriteStream(options.path, { flags });
  const destination = createNodeStreamDestination({
    name: options.name,
    stream,
    minLength: options.minLength,
    syncWrite,
  });
  const releaseSync = () => {
    if (fd !== undefined) {
      closeSync(fd);
      fd = undefined;
    }
  };
  return {
    ...destination,
    stream,
    close() {
      return destination.close().finally(releaseSync);
    },
    closeSync() {
      destination.closeSync();
      releaseSync();
    },
    releaseSync,
  };
}
