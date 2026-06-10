# @loggerjs/database

SQLite, PostgreSQL, and custom database transports for loggerjs.

```ts
import { createLogger } from "@loggerjs/core";
import { sqliteTransport } from "@loggerjs/database/sqlite";

const logger = createLogger({
  name: "audit",
  transports: [
    sqliteTransport({
      database,
      createTable: true,
      table: "loggerjs_logs",
    }),
  ],
});
```

```ts
import { createLogger } from "@loggerjs/core";
import { postgresTransport } from "@loggerjs/database/postgres";

const logger = createLogger({
  name: "audit",
  transports: [
    postgresTransport({
      client,
      createTable: true,
      table: "public.loggerjs_logs",
    }),
  ],
});
```

The transport keeps driver dependencies external. Pass a `better-sqlite3`-style prepared database, a `sqlite3` callback database, a `pg`-style client, or a custom adapter through `databaseTransport`.
