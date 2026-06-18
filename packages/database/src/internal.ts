import type { TransportContext } from "@loggerjs/core";
import type { DatabaseLogRow, DatabaseLogValue } from "./transport";

export const databaseColumns = [
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

export function serializeOptional(
  value: unknown,
  serialize: (value: unknown) => string,
): string | null {
  return value === undefined ? null : serialize(value);
}

export function reportTransportError(
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

export function rowValues(row: DatabaseLogRow): DatabaseLogValue[] {
  return databaseColumns.map(([, key]) => row[key]);
}

export function quoteIdentifier(identifier: string): string {
  return identifier
    .split(".")
    .map((part) => `"${part.split('"').join('""')}"`)
    .join(".");
}

export function columnList() {
  return databaseColumns.map(([column]) => quoteIdentifier(column)).join(", ");
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return !!value && typeof (value as { then?: unknown }).then === "function";
}

export async function maybeAwait(value: unknown) {
  if (isPromiseLike(value)) await value;
}
