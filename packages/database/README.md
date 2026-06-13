# @loggerjs/database

> Persist LoggerJS logs to SQLite, PostgreSQL, or any custom database adapter.

[![npm](https://img.shields.io/npm/v/@loggerjs/database.svg)](https://www.npmjs.com/package/@loggerjs/database)
[![license](https://img.shields.io/npm/l/@loggerjs/database)](../../LICENSE)

Batch transports for [LoggerJS](../../README.md) that write structured logs into a database. **Drivers stay external** — you pass in the database/client you already use, so this package bundles no native bindings.

## Install

```bash
npm install @loggerjs/database
# plus whichever driver you use:
npm install better-sqlite3   # or: sqlite3
npm install pg
```

## Usage

### SQLite

```ts
import { createLogger } from "@loggerjs/core";
import { sqliteTransport } from "@loggerjs/database/sqlite";

const logger = createLogger({
  category: ["audit"],
  transports: [
    sqliteTransport({
      database,           // a better-sqlite3-style or sqlite3 callback database
      createTable: true,
      table: "loggerjs_logs",
    }),
  ],
});
```

### PostgreSQL

```ts
import { createLogger } from "@loggerjs/core";
import { postgresTransport } from "@loggerjs/database/postgres";

const logger = createLogger({
  category: ["audit"],
  transports: [
    postgresTransport({
      client,             // a pg-style client or pool
      createTable: true,
      table: "public.loggerjs_logs",
    }),
  ],
});
```

## What's included

| Export | Purpose |
| --- | --- |
| `sqliteTransport` | Batch transport for `better-sqlite3`-style or `sqlite3` callback databases. |
| `postgresTransport` | Batch transport for a `pg`-style client or pool. |
| `databaseTransport` | Driver-agnostic transport — accepts any custom adapter. |
| `createSQLiteDatabaseAdapter`, `createPostgresDatabaseAdapter`, `createDatabaseLogRow` | Building blocks for custom adapters and row shapes. |

All three transports batch writes and inherit the shared retry, backoff, and circuit-breaker reliability options (see [TRANSPORTS.md](../../docs/TRANSPORTS.md)). Set `createTable: true` to auto-create the target table, or manage the schema yourself.

## Subpath exports

`@loggerjs/database/sqlite` · `@loggerjs/database/postgres` · `@loggerjs/database/transport`

## Documentation

- [Transports](../../docs/TRANSPORTS.md) · [Operations](../../docs/OPERATIONS.md) · [LoggerJS root README](../../README.md)

## License

[MIT](../../LICENSE) © JS Kits
