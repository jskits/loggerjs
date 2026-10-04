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

// Deep enough for real cause chains while bounding work on pathological ones.
const MAX_CAUSE_DEPTH = 8;

export function normalizeError(
  error: unknown,
  options: NormalizeErrorOptions = {},
): SerializedError {
  return normalizeErrorInChain(error, options, []);
}

function normalizeErrorInChain(
  error: unknown,
  options: NormalizeErrorOptions,
  outer: unknown[],
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
    const cause = maybeError.cause;
    if (cause !== undefined) {
      // Normalize Error causes too: fast codecs use native JSON.stringify,
      // which turns an Error into {} and silently drops the cause chain.
      const chain = [...outer, error];
      out.cause = !(cause instanceof Error)
        ? cause
        : chain.includes(cause)
          ? "[Circular]"
          : chain.length > MAX_CAUSE_DEPTH
            ? { name: cause.name, message: cause.message }
            : normalizeErrorInChain(cause, options, chain);
    }
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
      ...record,
      name: typeof record.name === "string" ? record.name : undefined,
      message: typeof record.message === "string" ? record.message : String(error),
      stack:
        typeof record.stack === "string" ? stackWithLimit(record.stack, maxStackLines) : undefined,
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
