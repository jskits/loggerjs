import {
  batchTransport,
  safeJsonCodec,
  safeJsonStringify,
  type BatchTransportOptions,
  type Codec,
  type LogEvent,
  type LoggerLevel,
  type Transport,
} from "@loggerjs/core";
import { reportTransportError, serializeOptional } from "./internal";

export type DatabaseLogValue = string | number | Uint8Array | null;

export interface DatabaseLogRow {
  id: string;
  time: number;
  seq: number;
  level: number;
  levelName: string;
  logger: string;
  type: string | null;
  message: string;
  tags: string | null;
  data: string | null;
  error: string | null;
  context: string | null;
  trace: string | null;
  source: string | null;
  payload: string | Uint8Array;
}

export interface DatabaseTransportAdapter {
  insert: (rows: readonly DatabaseLogRow[]) => void | Promise<void>;
  flush?: () => void | Promise<void>;
  close?: () => void | Promise<void>;
}

export interface DatabaseLogRowOptions {
  codec?: Codec<string | Uint8Array>;
  serialize?: (value: unknown) => string;
}

export interface DatabaseTransportOptions extends BatchTransportOptions, DatabaseLogRowOptions {
  adapter: DatabaseTransportAdapter;
  minLevel?: LoggerLevel;
  mapEvent?: (event: LogEvent, context: DatabaseLogRowOptions) => DatabaseLogRow | null | undefined;
  onError?: (error: unknown, detail: { operation: string }) => void;
}

export function createDatabaseLogRow(
  event: LogEvent,
  options: DatabaseLogRowOptions = {},
): DatabaseLogRow {
  const codec = options.codec ?? safeJsonCodec();
  const serialize = options.serialize ?? safeJsonStringify;

  return {
    id: event.id,
    time: event.time,
    seq: event.seq,
    level: event.level,
    levelName: event.levelName,
    logger: event.logger,
    type: event.type ?? null,
    message: event.message,
    tags: serializeOptional(event.tags, serialize),
    data: serializeOptional(event.data, serialize),
    error: serializeOptional(event.error, serialize),
    context: serializeOptional(event.context, serialize),
    trace: serializeOptional(event.trace, serialize),
    source: serializeOptional(event.source, serialize),
    payload: codec.encode(event),
  };
}

export function databaseTransport(options: DatabaseTransportOptions): Transport {
  const rowOptions: DatabaseLogRowOptions = {
    codec: options.codec,
    serialize: options.serialize,
  };
  const mapEvent =
    options.mapEvent ??
    ((event: LogEvent, context: DatabaseLogRowOptions) => createDatabaseLogRow(event, context));
  const transportName = options.name ?? "database";

  const inner: Transport = {
    name: `${transportName}-inner`,
    minLevel: options.minLevel,
    async logBatch(events, context) {
      const rows: DatabaseLogRow[] = [];

      for (const event of events) {
        try {
          const row = mapEvent(event, rowOptions);
          if (row) rows.push(row);
        } catch (error) {
          reportTransportError(
            { name: transportName, onError: options.onError },
            context,
            error,
            "map-event",
          );
        }
      }

      if (rows.length === 0) return;

      try {
        await options.adapter.insert(rows);
      } catch (error) {
        reportTransportError(
          { name: transportName, onError: options.onError },
          context,
          error,
          "insert",
        );
        throw error;
      }
    },
    flush: options.adapter.flush,
    close: options.adapter.close,
  };

  return batchTransport(inner, {
    name: transportName,
    maxRecords: options.maxRecords,
    maxBatchSize: options.maxBatchSize,
    maxBytes: options.maxBytes,
    maxWaitMs: options.maxWaitMs,
    flushIntervalMs: options.flushIntervalMs,
    concurrency: options.concurrency,
    maxQueueSize: options.maxQueueSize,
    dropPolicy: options.dropPolicy,
    estimateEventBytes: options.estimateEventBytes,
    maxRetries: options.maxRetries,
    retryBaseDelayMs: options.retryBaseDelayMs,
    retryMaxDelayMs: options.retryMaxDelayMs,
    random: options.random,
    circuitBreakerFailureThreshold: options.circuitBreakerFailureThreshold,
    circuitBreakerResetMs: options.circuitBreakerResetMs,
    onDrop: options.onDrop,
  });
}
