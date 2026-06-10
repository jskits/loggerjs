import type { SerializedError } from "../types";

export interface NormalizeErrorOptions {
  maxStackLines?: number;
  includeEnumerableProperties?: boolean;
}

function stackWithLimit(stack: string | undefined, maxStackLines: number): string | undefined {
  if (!stack) return undefined;
  if (maxStackLines <= 0) return undefined;
  return stack.split("\n").slice(0, maxStackLines).join("\n");
}

export function normalizeError(
  error: unknown,
  options: NormalizeErrorOptions = {},
): SerializedError {
  const maxStackLines = options.maxStackLines ?? 80;
  const includeEnumerableProperties = options.includeEnumerableProperties ?? true;

  if (error instanceof Error) {
    const out: SerializedError = {
      name: error.name,
      message: error.message,
      stack: stackWithLimit(error.stack, maxStackLines),
    };

    const maybeError = error as Error & { cause?: unknown; code?: string | number };
    if (maybeError.cause !== undefined) out.cause = maybeError.cause;
    if (maybeError.code !== undefined) out.code = maybeError.code;

    if (includeEnumerableProperties) {
      for (const key of Object.keys(error)) {
        if (!(key in out)) out[key] = (error as unknown as Record<string, unknown>)[key];
      }
    }
    return out;
  }

  if (typeof error === "string") return { message: error };
  if (error && typeof error === "object") {
    const record = error as unknown as Record<string, unknown>;
    return {
      name: typeof record.name === "string" ? record.name : undefined,
      message: typeof record.message === "string" ? record.message : String(error),
      stack:
        typeof record.stack === "string" ? stackWithLimit(record.stack, maxStackLines) : undefined,
      ...record,
    };
  }

  return { message: String(error) };
}

export function valueToMessage(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  try {
    return String(value);
  } catch {
    return "[Unstringifiable]";
  }
}
