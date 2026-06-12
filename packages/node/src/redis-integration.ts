import {
  databaseIntegration,
  type DatabaseClientLike,
  type DatabaseIntegrationOptions,
} from "./database-integration";

export interface RedisIntegrationOptions extends Omit<
  DatabaseIntegrationOptions,
  "client" | "system" | "methods" | "getStatement"
> {
  client: DatabaseClientLike;
  methods?: readonly string[];
}

const redisMethods = [
  "del",
  "get",
  "hget",
  "hset",
  "lpush",
  "publish",
  "rpush",
  "set",
  "xadd",
] as const;

function redisStatement(args: readonly unknown[], method: string): string | undefined {
  const key = args[0] === undefined ? "" : ` ${String(args[0])}`;
  return `${method.toUpperCase()}${key}`;
}

export function redisIntegration(options: RedisIntegrationOptions) {
  return databaseIntegration({
    ...options,
    name: options.name ?? "redis",
    system: "redis",
    methods: options.methods ?? redisMethods,
    getStatement: redisStatement,
  });
}
