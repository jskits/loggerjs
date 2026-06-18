import type { Transport } from "@loggerjs/core";
import { columnList, databaseColumns, quoteIdentifier, rowValues } from "./internal";
import {
  databaseTransport,
  type DatabaseLogValue,
  type DatabaseTransportAdapter,
  type DatabaseTransportOptions,
} from "./transport";

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
