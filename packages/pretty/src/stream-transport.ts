import {
  toLevelValue,
  type LogEvent,
  type LogRecord,
  type LoggerLevel,
  type Transport,
  type TransportContext,
} from "@loggerjs/core";
import { formatPrettyEvent, type PrettyFormatterOptions } from "./formatter";

export interface PrettyWritableLike {
  isTTY?: boolean;
  write: (chunk: string) => unknown;
  on?: (event: "error", listener: (error: Error) => void) => unknown;
  off?: (event: "error", listener: (error: Error) => void) => unknown;
  once?: (event: "drain", listener: () => void) => unknown;
  end?: (callback?: (error?: Error | null) => void) => unknown;
}

export interface PrettyProcessLike {
  stdout?: PrettyWritableLike;
  stderr?: PrettyWritableLike;
  env?: Record<string, string | undefined>;
}

export interface PrettyStreamTransportOptions extends PrettyFormatterOptions {
  name?: string;
  stream?: PrettyWritableLike;
  process?: PrettyProcessLike;
  minLevel?: LoggerLevel;
  newline?: string;
  endOnClose?: boolean;
}

export type PrettyStdoutTransportOptions = Omit<PrettyStreamTransportOptions, "stream"> & {
  stream?: PrettyWritableLike;
};

interface FlushWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function currentProcess(): PrettyProcessLike | undefined {
  return (globalThis as unknown as { process?: PrettyProcessLike }).process;
}

function processFor(options: PrettyStreamTransportOptions): PrettyProcessLike | undefined {
  return options.process ?? currentProcess();
}

function shouldUseAnsi(stream: PrettyWritableLike, options: PrettyStreamTransportOptions): boolean {
  if (options.colors === "always") return true;
  if (options.colors === "never") return false;
  const env = processFor(options)?.env;
  if (env?.NO_COLOR !== undefined) return false;
  if (env?.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "0") return true;
  return stream.isTTY === true;
}

function streamFromProcess(
  options: PrettyStreamTransportOptions,
  key: "stdout" | "stderr",
): PrettyWritableLike {
  const stream = processFor(options)?.[key];
  if (!stream) {
    throw new Error(`pretty ${key} transport requires a writable stream or process.${key}`);
  }
  return stream;
}

export function prettyStreamTransport(options: PrettyStreamTransportOptions = {}): Transport {
  const stream = options.stream ?? streamFromProcess(options, "stdout");
  const useAnsi = shouldUseAnsi(stream, options);
  const newline = options.newline ?? "\n";
  const waiters: FlushWaiter[] = [];
  let pendingDrains = 0;
  let lastError: Error | undefined;
  let lastContext: TransportContext | undefined;
  let closed = false;

  const settleWaitersIfIdle = () => {
    if (pendingDrains > 0 || waiters.length === 0) return;
    const error = lastError;
    lastError = undefined;
    for (const waiter of waiters.splice(0)) {
      if (error) waiter.reject(error);
      else waiter.resolve();
    }
  };

  const recordError = (error: unknown, operation: string) => {
    lastError = normalizeError(error);
    lastContext?.reportInternalError(lastError, {
      phase: "transport",
      transport: options.name ?? "pretty-stream",
      operation,
    });
    settleWaitersIfIdle();
  };

  const onError = (error: Error) => recordError(error, "stream-error");
  stream.on?.("error", onError);

  const waitForDrain = () => {
    if (!stream.once) return;
    pendingDrains += 1;
    stream.once("drain", () => {
      pendingDrains -= 1;
      settleWaitersIfIdle();
    });
  };

  const writePayload = (payload: string, context: TransportContext) => {
    if (closed) return;
    lastContext = context;
    try {
      const result = stream.write(payload);
      if (result === false) waitForDrain();
    } catch (error) {
      recordError(error, "write");
    }
  };

  const writeEvent = (event: LogEvent, context: TransportContext) => {
    if (options.minLevel !== undefined && event.level < toLevelValue(options.minLevel)) return;
    const rendered = formatPrettyEvent(event, { ...options, colors: useAnsi ? "always" : "never" });
    writePayload(`${useAnsi ? rendered.ansiText : rendered.text}${newline}`, context);
  };

  const transport: Transport = {
    name: options.name ?? "pretty-stream",
    minLevel: options.minLevel,
    write(record: LogRecord, context) {
      writeEvent(context.toEvent(record), context);
    },
    writeBatch(records, context) {
      for (const record of records) writeEvent(context.toEvent(record), context);
    },
    log(event, context) {
      writeEvent(event, context);
    },
    logBatch(events, context) {
      for (const event of events) writeEvent(event, context);
    },
    flush() {
      if (pendingDrains === 0) {
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
      // Stream writes are already issued synchronously. Backpressure is observed
      // by async flush() through drain events.
    },
    close() {
      return Promise.resolve(transport.flush?.()).then(
        () =>
          new Promise<void>((resolve, reject) => {
            closed = true;
            stream.off?.("error", onError);
            if (!options.endOnClose || !stream.end) {
              resolve();
              return;
            }
            stream.end((error?: Error | null) => {
              if (error) reject(error);
              else resolve();
            });
          }),
      );
    },
  };

  return transport;
}

export function prettyStdoutTransport(options: PrettyStdoutTransportOptions = {}): Transport {
  return prettyStreamTransport({
    ...options,
    name: options.name ?? "pretty-stdout",
    stream: options.stream ?? streamFromProcess(options, "stdout"),
  });
}

export function prettyStderrTransport(options: PrettyStdoutTransportOptions = {}): Transport {
  return prettyStreamTransport({
    ...options,
    name: options.name ?? "pretty-stderr",
    stream: options.stream ?? streamFromProcess(options, "stderr"),
  });
}
