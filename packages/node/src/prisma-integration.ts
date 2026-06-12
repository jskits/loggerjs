import {
  databaseIntegration,
  type DatabaseClientLike,
  type DatabaseIntegrationOptions,
} from "./database-integration";

export interface PrismaIntegrationOptions extends Omit<
  DatabaseIntegrationOptions,
  "client" | "system" | "methods" | "getStatement"
> {
  client: DatabaseClientLike;
}

const prismaMethods = ["$executeRaw", "$executeRawUnsafe", "$queryRaw", "$queryRawUnsafe"] as const;

function prismaStatement(args: readonly unknown[]): string | undefined {
  const first = args[0];
  if (typeof first === "string") return first;
  if (Array.isArray(first) && "raw" in first) return (first as { raw?: string[] }).raw?.join("?");
  return undefined;
}

export function prismaIntegration(options: PrismaIntegrationOptions) {
  return databaseIntegration({
    ...options,
    name: options.name ?? "prisma",
    system: "prisma",
    methods: prismaMethods,
    getStatement: prismaStatement,
  });
}
