export interface SafeStringifyOptions {
  maxDepth?: number;
  maxArrayLength?: number;
  maxObjectKeys?: number;
  includeStack?: boolean;
  stable?: boolean;
  space?: number;
}

export function normalizeValue(value: unknown, options: SafeStringifyOptions = {}): unknown {
  const maxDepth = options.maxDepth ?? 8;
  const maxArrayLength = options.maxArrayLength ?? 200;
  const maxObjectKeys = options.maxObjectKeys ?? 200;
  const includeStack = options.includeStack ?? true;
  const stable = options.stable ?? false;
  const seen = new WeakSet<object>();

  const walk = (input: unknown, depth: number): unknown => {
    if (input === null || input === undefined) return input;

    const type = typeof input;
    if (type === "string" || type === "number" || type === "boolean") return input;
    if (type === "bigint") return input.toString();
    if (type === "symbol") return String(input);
    if (type === "function") return `[Function ${(input as Function).name || "anonymous"}]`;

    if (input instanceof Date) return input.toISOString();
    if (input instanceof RegExp) return String(input);
    if (input instanceof Error) {
      const errorOut: Record<string, unknown> = {
        name: input.name,
        message: input.message,
      };
      if (includeStack && input.stack) errorOut.stack = input.stack;
      const record = input as unknown as Record<string, unknown>;
      for (const key of Object.keys(record)) errorOut[key] = record[key];
      return walk(errorOut, depth + 1);
    }

    if (typeof input !== "object") return String(input);
    if (seen.has(input)) return "[Circular]";
    if (depth >= maxDepth) return "[MaxDepth]";
    seen.add(input);

    if (Array.isArray(input)) {
      const out: unknown[] = [];
      const length = Math.min(input.length, maxArrayLength);
      for (let i = 0; i < length; i += 1) out.push(walk(input[i], depth + 1));
      if (input.length > maxArrayLength)
        out.push(`[Truncated ${input.length - maxArrayLength} items]`);
      return out;
    }

    if (input instanceof Map) {
      return walk(Object.fromEntries(input), depth + 1);
    }
    if (input instanceof Set) {
      return walk(Array.from(input), depth + 1);
    }

    const record = input as unknown as Record<string, unknown>;
    const keys = Object.keys(record);
    if (stable) keys.sort();
    const out: Record<string, unknown> = {};
    const length = Math.min(keys.length, maxObjectKeys);
    for (let i = 0; i < length; i += 1) {
      const key = keys[i]!;
      out[key] = walk(record[key], depth + 1);
    }
    if (keys.length > maxObjectKeys) out["__truncatedKeys"] = keys.length - maxObjectKeys;
    return out;
  };

  return walk(value, 0);
}

export function safeJsonStringify(value: unknown, options: SafeStringifyOptions = {}): string {
  return JSON.stringify(normalizeValue(value, options), null, options.space);
}
