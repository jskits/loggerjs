import {
  batchTransport,
  safeJsonCodec,
  safeJsonStringify,
  type BatchTransportOptions,
  type Codec,
  type LogEvent,
  type LoggerLevel,
  type Transport,
  type TransportContext,
} from "@loggerjs/core";

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

export type SQLiteConflictMode = "error" | "ignore" | "replace";
export type SQLiteDriverMode = "auto" | "prepared" | "callback" | "promise";

export interface SQLiteStatementLike {
  run: (...values: unknown[]) => unknown;
}

export interface SQLiteDatabaseLike {
  exec?: (sql: string) => unknown;
  prepare?: (sql: string) => SQLiteStatementLike;
  run?: (
    sql: string,
    values?: readonly unknown[],
    callback?: (error: Error | null | undefined) => void,
  ) => unknown;
  transaction?: (
    fn: (rows: readonly DatabaseLogRow[]) => void,
  ) => (rows: readonly DatabaseLogRow[]) => void;
}

export interface SQLiteTransportOptions extends Omit<DatabaseTransportOptions, "adapter"> {
  database: SQLiteDatabaseLike;
  table?: string;
  createTable?: boolean;
  conflict?: SQLiteConflictMode;
  driverMode?: SQLiteDriverMode;
  payloadColumnType?: string;
}

export type PostgresConflictMode = "error" | "ignore";

export interface PostgresClientLike {
  query: (sql: string, values?: readonly unknown[]) => unknown | Promise<unknown>;
}

export interface PostgresTransportOptions extends Omit<DatabaseTransportOptions, "adapter"> {
  client: PostgresClientLike;
  table?: string;
  createTable?: boolean;
  conflict?: PostgresConflictMode;
  payloadColumnType?: string;
}

const databaseColumns = [
  ["id", "id"],
  ["time", "time"],
  ["seq", "seq"],
  ["level", "level"],
  ["level_name", "levelName"],
  ["logger", "logger"],
  ["type", "type"],
  ["message", "message"],
  ["tags", "tags"],
  ["data", "data"],
  ["error", "error"],
  ["context", "context"],
  ["trace", "trace"],
  ["source", "source"],
  ["payload", "payload"],
] as const satisfies readonly (readonly [string, keyof DatabaseLogRow])[];

function serializeOptional(value: unknown, serialize: (value: unknown) => string): string | null {
  return value === undefined ? null : serialize(value);
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

function reportTransportError(
  options: { name?: string; onError?: (error: unknown, detail: { operation: string }) => void },
  context: TransportContext,
  error: unknown,
  operation: string,
) {
  try {
    options.onError?.(error, { operation });
  } catch (onErrorError) {
    context.reportInternalError(onErrorError, {
      operation: "on-error",
      phase: "transport",
      transport: options.name ?? "database",
    });
  }

  context.reportInternalError(error, {
    operation,
    phase: "transport",
    transport: options.name ?? "database",
  });
}

function rowValues(row: DatabaseLogRow): DatabaseLogValue[] {
  return databaseColumns.map(([, key]) => row[key]);
}

function quoteIdentifier(identifier: string): string {
  return identifier
    .split(".")
    .map((part) => `"${part.split('"').join('""')}"`)
    .join(".");
}

function columnList() {
  return databaseColumns.map(([column]) => quoteIdentifier(column)).join(", ");
}

function sqliteInsertVerb(conflict: SQLiteConflictMode) {
  if (conflict === "ignore") return "INSERT OR IGNORE INTO";
  if (conflict === "replace") return "INSERT OR REPLACE INTO";
  return "INSERT INTO";
}

function sqliteCreateTableSql(table: string, payloadColumnType: string) {
  return `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(table)} (
  "id" TEXT PRIMARY KEY,
  "time" INTEGER NOT NULL,
  "seq" INTEGER NOT NULL,
  "level" INTEGER NOT NULL,
  "level_name" TEXT NOT NULL,
  "logger" TEXT NOT NULL,
  "type" TEXT,
  "message" TEXT NOT NULL,
  "tags" TEXT,
  "data" TEXT,
  "error" TEXT,
  "context" TEXT,
  "trace" TEXT,
  "source" TEXT,
  "payload" ${payloadColumnType} NOT NULL
)`;
}

function postgresCreateTableSql(table: string, payloadColumnType: string) {
  return `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(table)} (
  "id" TEXT PRIMARY KEY,
  "time" BIGINT NOT NULL,
  "seq" BIGINT NOT NULL,
  "level" INTEGER NOT NULL,
  "level_name" TEXT NOT NULL,
  "logger" TEXT NOT NULL,
  "type" TEXT,
  "message" TEXT NOT NULL,
  "tags" JSONB,
  "data" JSONB,
  "error" JSONB,
  "context" JSONB,
  "trace" JSONB,
  "source" JSONB,
  "payload" ${payloadColumnType} NOT NULL
)`;
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return !!value && typeof (value as { then?: unknown }).then === "function";
}

async function maybeAwait(value: unknown) {
  if (isPromiseLike(value)) await value;
}

function runSqlite(
  database: SQLiteDatabaseLike,
  sql: string,
  values: readonly unknown[],
  mode: SQLiteDriverMode,
) {
  if (mode === "promise") return maybeAwait(database.run?.(sql, values));
  if (mode === "callback") {
    return new Promise<void>((resolve, reject) => {
      database.run?.(sql, values, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  const statement = database.prepare?.(sql);
  if (statement) return maybeAwait(statement.run(...values));
  return new Promise<void>((resolve, reject) => {
    database.run?.(sql, values, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function ensureSQLiteTable(
  database: SQLiteDatabaseLike,
  sql: string,
  mode: SQLiteDriverMode,
) {
  if (mode === "prepared" || (mode === "auto" && database.prepare)) {
    if (database.exec) {
      await maybeAwait(database.exec(sql));
      return;
    }
    await maybeAwait(database.prepare?.(sql).run());
    return;
  }

  await runSqlite(database, sql, [], mode === "auto" ? "callback" : mode);
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

export function createSQLiteDatabaseAdapter(
  options: Pick<
    SQLiteTransportOptions,
    "conflict" | "createTable" | "database" | "driverMode" | "payloadColumnType" | "table"
  >,
): DatabaseTransportAdapter {
  const database = options.database;
  const table = options.table ?? "loggerjs_logs";
  const mode = options.driverMode ?? "auto";
  const placeholders = databaseColumns.map(() => "?").join(", ");
  const sql = `${sqliteInsertVerb(options.conflict ?? "ignore")} ${quoteIdentifier(table)} (${columnList()}) VALUES (${placeholders})`;
  let statement: SQLiteStatementLike | undefined;
  let ready: Promise<void> | undefined;

  const ensureReady = () => {
    if (!options.createTable) return Promise.resolve();
    ready ??= ensureSQLiteTable(
      database,
      sqliteCreateTableSql(table, options.payloadColumnType ?? "TEXT"),
      mode,
    );
    return ready;
  };

  return {
    async insert(rows) {
      await ensureReady();

      if (mode === "prepared" || (mode === "auto" && database.prepare)) {
        statement ??= database.prepare?.(sql);
        if (!statement) throw new Error("SQLite database does not support prepared statements");
        const runRows = (batchRows: readonly DatabaseLogRow[]) => {
          for (const row of batchRows) statement!.run(...rowValues(row));
        };
        const transaction = rows.length > 1 ? database.transaction?.(runRows) : undefined;
        if (transaction) transaction(rows);
        else runRows(rows);
        return;
      }

      for (const row of rows) {
        // oxlint-disable-next-line no-await-in-loop -- SQLite callback drivers serialize writes.
        await runSqlite(database, sql, rowValues(row), mode === "auto" ? "callback" : mode);
      }
    },
  };
}

export function sqliteTransport(options: SQLiteTransportOptions): Transport {
  return databaseTransport({
    ...options,
    adapter: createSQLiteDatabaseAdapter(options),
    name: options.name ?? "sqlite",
  });
}

export function createPostgresDatabaseAdapter(
  options: Pick<
    PostgresTransportOptions,
    "client" | "conflict" | "createTable" | "payloadColumnType" | "table"
  >,
): DatabaseTransportAdapter {
  const client = options.client;
  const table = options.table ?? "loggerjs_logs";
  let ready: Promise<void> | undefined;

  const ensureReady = async () => {
    if (!options.createTable) return;
    ready ??= Promise.resolve(
      client.query(postgresCreateTableSql(table, options.payloadColumnType ?? "JSONB")),
    ).then(() => undefined);
    await ready;
  };

  return {
    async insert(rows) {
      await ensureReady();
      if (rows.length === 0) return;

      const values: DatabaseLogValue[] = [];
      const tuples = rows.map((row) => {
        const start = values.length;
        values.push(...rowValues(row));
        return `(${databaseColumns.map((_, index) => `$${start + index + 1}`).join(", ")})`;
      });
      const conflict =
        (options.conflict ?? "ignore") === "ignore" ? ' ON CONFLICT ("id") DO NOTHING' : "";
      const sql = `INSERT INTO ${quoteIdentifier(table)} (${columnList()}) VALUES ${tuples.join(", ")}${conflict}`;
      await client.query(sql, values);
    },
  };
}

export function postgresTransport(options: PostgresTransportOptions): Transport {
  return databaseTransport({
    ...options,
    adapter: createPostgresDatabaseAdapter(options),
    name: options.name ?? "postgres",
  });
}
