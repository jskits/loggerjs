import { describe, expect, it, vi } from "vitest";
import { recordToEvent, type LogEvent, type TransportContext } from "@loggerjs/core";
import {
  createDatabaseLogRow,
  databaseTransport,
  postgresTransport,
  sqliteTransport,
  type DatabaseLogRow,
  type PostgresClientLike,
  type SQLiteDatabaseLike,
} from "../src";

const event: LogEvent = {
  id: "evt-1",
  time: 123,
  seq: 1,
  level: 30,
  levelName: "info",
  logger: "api",
  type: "order.created",
  message: "created",
  tags: { route: "/orders" },
  data: { orderId: "ord-1" },
  context: { requestId: "req-1" },
};

const secondEvent: LogEvent = {
  ...event,
  id: "evt-2",
  seq: 2,
  message: "updated",
};

function createContext(errors: unknown[] = []): TransportContext {
  return {
    loggerName: "api",
    now: () => 1,
    toEvent: recordToEvent,
    reportInternalError(error) {
      errors.push(error);
    },
  };
}

describe("databaseTransport", () => {
  it("maps batches into stable database rows", async () => {
    const inserted: DatabaseLogRow[][] = [];
    const transport = databaseTransport({
      adapter: {
        insert(rows) {
          inserted.push([...rows]);
        },
      },
      maxRecords: 2,
    });

    transport.log?.(event, createContext());
    transport.log?.(secondEvent, createContext());
    await transport.flush?.();

    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.[0]).toMatchObject({
      id: "evt-1",
      levelName: "info",
      logger: "api",
      message: "created",
      type: "order.created",
    });
    expect(inserted[0]?.[0]?.tags).toBe('{"route":"/orders"}');
    expect(inserted[0]?.[0]?.payload).toContain('"id":"evt-1"');
  });

  it("reports mapper failures without inserting an empty batch", async () => {
    const errors: unknown[] = [];
    const onError = vi.fn<(error: unknown, detail: { operation: string }) => void>();
    const insert = vi.fn<(rows: readonly DatabaseLogRow[]) => void>();
    const transport = databaseTransport({
      adapter: { insert },
      mapEvent() {
        throw new Error("bad map");
      },
      maxRecords: 1,
      onError,
    });

    transport.log?.(event, createContext(errors));
    await transport.flush?.();

    expect(insert).not.toHaveBeenCalled();
    expect(errors).toHaveLength(1);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), { operation: "map-event" });
  });

  it("creates a row with custom serializers", () => {
    const row = createDatabaseLogRow(event, {
      codec: {
        name: "payload",
        contentType: "application/octet-stream",
        encode: () => new Uint8Array([1, 2, 3]),
      },
      serialize: (value) => `serialized:${String(value)}`,
    });

    expect(row.data).toBe("serialized:[object Object]");
    expect(row.payload).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe("sqliteTransport", () => {
  it("uses prepared statements and transactions for SQLite batches", async () => {
    const statements: string[] = [];
    const runs: unknown[][] = [];
    const exec = vi.fn<(sql: string) => void>();
    const transaction = vi.fn<
      (fn: (rows: readonly DatabaseLogRow[]) => void) => (rows: readonly DatabaseLogRow[]) => void
    >((fn: (rows: readonly DatabaseLogRow[]) => void) => (rows: readonly DatabaseLogRow[]) => {
      fn(rows);
    });
    const database: SQLiteDatabaseLike = {
      exec,
      prepare(sql) {
        statements.push(sql);
        return {
          run(...values) {
            runs.push(values);
          },
        };
      },
      transaction,
    };
    const transport = sqliteTransport({
      createTable: true,
      database,
      maxRecords: 2,
      table: "logs",
    });

    transport.log?.(event, createContext());
    transport.log?.(secondEvent, createContext());
    await transport.flush?.();

    expect(exec).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS "logs"'));
    expect(statements[0]).toContain("INSERT OR IGNORE INTO");
    expect(statements[0]).toContain('"level_name"');
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(runs).toHaveLength(2);
    expect(runs[0]?.[0]).toBe("evt-1");
    expect(runs[1]?.[0]).toBe("evt-2");
  });

  it("supports callback-style SQLite drivers", async () => {
    const runs: Array<{ sql: string; values: readonly unknown[] }> = [];
    const database: SQLiteDatabaseLike = {
      run(sql, values, callback) {
        runs.push({ sql, values: values ?? [] });
        callback?.(undefined);
      },
    };
    const transport = sqliteTransport({
      conflict: "replace",
      database,
      driverMode: "callback",
      maxRecords: 1,
    });

    transport.log?.(event, createContext());
    await transport.flush?.();

    expect(runs).toHaveLength(1);
    expect(runs[0]?.sql).toContain("INSERT OR REPLACE INTO");
    expect(runs[0]?.values[0]).toBe("evt-1");
  });
});

describe("postgresTransport", () => {
  it("writes multi-row inserts with positional placeholders", async () => {
    const queries: Array<{ sql: string; values?: readonly unknown[] }> = [];
    const client: PostgresClientLike = {
      query(sql, values) {
        queries.push({ sql, values });
      },
    };
    const transport = postgresTransport({
      client,
      createTable: true,
      maxRecords: 2,
      table: "public.logs",
    });

    transport.log?.(event, createContext());
    transport.log?.(secondEvent, createContext());
    await transport.flush?.();

    expect(queries[0]?.sql).toContain('CREATE TABLE IF NOT EXISTS "public"."logs"');
    expect(queries[1]?.sql).toContain('INSERT INTO "public"."logs"');
    expect(queries[1]?.sql).toContain("$1");
    expect(queries[1]?.sql).toContain("$30");
    expect(queries[1]?.sql).toContain('ON CONFLICT ("id") DO NOTHING');
    expect(queries[1]?.values).toHaveLength(30);
    expect(queries[1]?.values?.[0]).toBe("evt-1");
    expect(queries[1]?.values?.[15]).toBe("evt-2");
  });
});
