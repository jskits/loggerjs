import type { Transport } from "@loggerjs/core";
import { columnList, databaseColumns, maybeAwait, quoteIdentifier, rowValues } from "./internal";
import {
  databaseTransport,
  type DatabaseLogRow,
  type DatabaseTransportAdapter,
  type DatabaseTransportOptions,
} from "./transport";

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
