import type { LogEvent, Processor } from "@loggerjs/core";

export type RedactMatcher =
  | string
  | RegExp
  | ((key: string, path: string, value: unknown) => boolean);

export interface RedactOptions {
  keys?: RedactMatcher[];
  paths?: string[];
  replacement?: string;
  censor?: string;
  remove?: boolean;
  maxDepth?: number;
}

function matchesKey(key: string, path: string, value: unknown, matchers: RedactMatcher[]): boolean {
  return matchers.some((matcher) => {
    if (typeof matcher === "string") return matcher.toLowerCase() === key.toLowerCase();
    if (matcher instanceof RegExp) {
      matcher.lastIndex = 0;
      const keyMatches = matcher.test(key);
      matcher.lastIndex = 0;
      return keyMatches || matcher.test(path);
    }
    return matcher(key, path, value);
  });
}

function pathMatches(path: string, paths: string[]): boolean {
  return paths.includes(path);
}

function redactValue(
  value: unknown,
  options: Required<Pick<RedactOptions, "replacement" | "remove" | "maxDepth">> &
    Pick<RedactOptions, "keys" | "paths">,
  path = "",
  depth = 0,
  seen = new WeakMap<object, unknown>(),
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  // Depth guard: past maxDepth we stop recursing, so we can no longer prove this
  // subtree is free of secrets. Fail closed by replacing the whole subtree rather
  // than emitting it verbatim. Returning `value` here leaks any configured key
  // (password, token, ...) nested deeper than maxDepth (default 8) in plaintext.
  // This matches privacyGuardProcessor / normalizeErrorProcessor, which already
  // fail closed at their depth limits.
  if (depth >= options.maxDepth) return options.replacement;
  if (seen.has(value)) return seen.get(value);

  if (Array.isArray(value)) {
    const out: unknown[] = [];
    seen.set(value, out);
    for (let index = 0; index < value.length; index += 1) {
      out[index] = redactValue(value[index], options, `${path}[${index}]`, depth + 1, seen);
    }
    return out;
  }

  if (value instanceof Error) return value;
  if (value instanceof Date) return value;

  const input = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  seen.set(value, out);
  for (const [key, child] of Object.entries(input)) {
    const childPath = path ? `${path}.${key}` : key;
    if (
      matchesKey(key, childPath, child, options.keys ?? []) ||
      pathMatches(childPath, options.paths ?? [])
    ) {
      if (options.remove) continue;
      out[key] = options.replacement;
    } else {
      out[key] = redactValue(child, options, childPath, depth + 1, seen);
    }
  }
  return out;
}

export function redactProcessor(options: RedactOptions = {}): Processor {
  const normalized = {
    keys: options.keys ?? [
      "password",
      "passwd",
      "secret",
      "token",
      "authorization",
      "cookie",
      "set-cookie",
      "apiKey",
      "api_key",
    ],
    paths: options.paths ?? [],
    replacement: options.replacement ?? options.censor ?? "[REDACTED]",
    remove: options.remove ?? false,
    maxDepth: options.maxDepth ?? 8,
  };

  return (event: LogEvent): LogEvent => ({
    ...event,
    data: redactValue(event.data, normalized),
    context: redactValue(event.context, normalized) as Record<string, unknown> | undefined,
    tags: redactValue(event.tags, normalized) as LogEvent["tags"],
    error: redactValue(event.error, normalized) as LogEvent["error"],
  });
}
