import {
  incrementLoggerMetaCounter,
  recordToEvent,
  retryTransport,
  toLevelValue,
  type LogEvent,
  type LoggerLevel,
  type RetryTransportOptions,
  type Transport,
  type TransportContext,
} from "@loggerjs/core";
import {
  indexedDbTransport,
  type IndexedDbTransportOptions,
  type IndexedDbTransportQueryOptions,
} from "./indexeddb-transport";

export interface OfflineFirstQueue {
  log: (event: LogEvent, context: TransportContext) => void | Promise<void>;
  flush?: () => void | Promise<void>;
  query: (options?: IndexedDbTransportQueryOptions) => AsyncIterable<LogEvent>;
  remove: (ids: string | readonly string[]) => Promise<void>;
  count?: () => Promise<number>;
  clear?: () => Promise<void>;
  close?: () => void | Promise<void>;
}

export interface OfflineFirstTransportOptions {
  name?: string;
  minLevel?: LoggerLevel;
  queue?: OfflineFirstQueue;
  queueOptions?: IndexedDbTransportOptions;
  replayBatchSize?: number;
  replayOnOnline?: boolean;
  online?: () => boolean;
  retry?: RetryTransportOptions;
  onQueued?: (event: LogEvent, error?: unknown) => void;
  onReplayed?: (events: readonly LogEvent[]) => void;
}

export interface OfflineFirstTransport extends Transport {
  replay: () => Promise<void>;
  queuedCount: () => Promise<number | undefined>;
  clearQueue: () => Promise<void>;
  queue: OfflineFirstQueue;
}

function normalizeBatchSize(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return 100;
  return Math.floor(value);
}

async function collectBatch(
  queue: OfflineFirstQueue,
  replayBatchSize: number,
): Promise<LogEvent[]> {
  const events: LogEvent[] = [];
  for await (const event of queue.query({ order: "asc", limit: replayBatchSize })) {
    events.push(event);
  }
  return events;
}

function isBrowserOnline(options: OfflineFirstTransportOptions): boolean {
  if (options.online) return options.online();
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

export function offlineFirstTransport(
  remote: Transport,
  options: OfflineFirstTransportOptions = {},
): OfflineFirstTransport {
  const name = options.name ?? `offline-first(${remote.name ?? "transport"})`;
  const replayBatchSize = normalizeBatchSize(options.replayBatchSize);
  const queueOptions = options.queueOptions;
  const queue: OfflineFirstQueue =
    options.queue ??
    (indexedDbTransport({
      dbName: "loggerjs-offline",
      flushIntervalMs: 0,
      name: `${name}:queue`,
      storeName: "offline-events",
      ...queueOptions,
      session: queueOptions?.session === undefined ? false : queueOptions.session,
    }) as OfflineFirstQueue);
  const reliableRemote = retryTransport(remote, {
    maxRetries: 2,
    retryBaseDelayMs: 250,
    retryMaxDelayMs: 5000,
    ...options.retry,
    name: `${name}:remote`,
  }) as Transport & {
    log: NonNullable<Transport["log"]>;
    logBatch: NonNullable<Transport["logBatch"]>;
  };
  let lastContext: TransportContext | undefined;
  let replayPromise: Promise<void> | undefined;

  const replayContext: TransportContext = {
    loggerName: name,
    now: () => Date.now(),
    toEvent: recordToEvent,
    reportInternalError() {},
  };

  const contextForReplay = () => lastContext ?? replayContext;

  const reportInternalError = (error: unknown, operation: string) => {
    contextForReplay().reportInternalError(error, {
      phase: "transport",
      transport: name,
      operation,
    });
  };

  const queueEvent = async (event: LogEvent, context: TransportContext, error?: unknown) => {
    await queue.log(event, context);
    await queue.flush?.();
    incrementLoggerMetaCounter("transport.offline.queued");
    options.onQueued?.(event, error);
  };

  const sendRemoteBatch = async (events: readonly LogEvent[], context: TransportContext) => {
    await reliableRemote.logBatch?.([...events], context);
  };

  const sendOrQueue = async (event: LogEvent, context: TransportContext) => {
    lastContext = context;
    if (!isBrowserOnline(options)) {
      await queueEvent(event, context);
      return;
    }

    try {
      await reliableRemote.log?.(event, context);
    } catch (error) {
      incrementLoggerMetaCounter("transport.offline.remote.failed");
      await queueEvent(event, context, error);
    }
  };

  const replay = async () => {
    if (replayPromise) return replayPromise;
    replayPromise = (async () => {
      if (!isBrowserOnline(options)) return;
      const context = contextForReplay();
      await queue.flush?.();

      for (;;) {
        // oxlint-disable-next-line no-await-in-loop -- Replay reads the next durable batch after prior deletes settle.
        const batch = await collectBatch(queue, replayBatchSize);
        if (batch.length === 0) return;
        try {
          // oxlint-disable-next-line no-await-in-loop -- Replay removes durable entries only after delivery succeeds.
          await sendRemoteBatch(batch, context);
          // oxlint-disable-next-line no-await-in-loop -- Delete only the delivered ids before reading the next batch.
          await queue.remove(batch.map((event) => event.id));
          incrementLoggerMetaCounter("transport.offline.replayed", batch.length);
          options.onReplayed?.(batch);
        } catch (error) {
          incrementLoggerMetaCounter("transport.offline.replay.failed");
          reportInternalError(error, "replay");
          throw error;
        }
      }
    })().finally(() => {
      replayPromise = undefined;
    });
    return replayPromise;
  };

  const onOnline = () => {
    void replay().catch((error: unknown) => reportInternalError(error, "online-replay"));
  };

  if (options.replayOnOnline ?? true) {
    globalThis.addEventListener?.("online", onOnline);
  }

  return {
    name,
    minLevel: options.minLevel ?? remote.minLevel,
    queue,
    write(record, context) {
      return sendOrQueue(context.toEvent(record), context);
    },
    writeBatch(records, context) {
      return Promise.all(
        records.map((record) => sendOrQueue(context.toEvent(record), context)),
      ).then(() => undefined);
    },
    log(event, context) {
      if (options.minLevel !== undefined && event.level < toLevelValue(options.minLevel)) return;
      return sendOrQueue(event, context);
    },
    logBatch(events, context) {
      return Promise.all(
        events.map((event) =>
          options.minLevel !== undefined && event.level < toLevelValue(options.minLevel)
            ? undefined
            : sendOrQueue(event, context),
        ),
      ).then(() => undefined);
    },
    replay,
    async flush() {
      await replay();
      await reliableRemote.flush?.();
      await queue.flush?.();
    },
    flushSync() {
      reliableRemote.flushSync?.();
    },
    async close() {
      globalThis.removeEventListener?.("online", onOnline);
      await replay();
      await reliableRemote.close?.();
      await queue.close?.();
    },
    async queuedCount() {
      await queue.flush?.();
      return queue.count?.();
    },
    async clearQueue() {
      await queue.clear?.();
    },
  };
}
