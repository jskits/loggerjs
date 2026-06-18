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

  if (value instanceof Date) return value;

  if (value instanceof Error) {
    // Redact configured keys carried as own-enumerable properties on an Error
    // (e.g. `err.password`). Returning the Error verbatim leaked them: errors
    // arrive raw when nested in data/context (before normalization), and both
    // JSON.stringify and safeJsonStringify emit an Error's own-enumerable props.
    // `name`/`message`/`stack` are non-enumerable and copied through unchanged.
    // Native `cause` and `AggregateError.errors` are also non-enumerable, but
    // codecs may expand them, so preserve and recurse into those fields too.
    const entries = Object.entries(value);
    const enumerableKeys = new Set(entries.map(([key]) => key));
    const nativeErrorFields = (["cause", "errors"] as const).filter(
      (field) => Object.prototype.hasOwnProperty.call(value, field) && !enumerableKeys.has(field),
    );
    if (entries.length === 0 && nativeErrorFields.length === 0) return value;

    const errorOut = Object.create(Object.getPrototypeOf(value)) as Record<string, unknown>;
    seen.set(value, errorOut);
    // Preserve message/stack as non-enumerable own data properties, read via the
    // getter (robust to V8's lazy `stack` accessor), so default output is
    // unchanged and only the extra enumerable props are redacted.
    for (const field of ["message", "stack"] as const) {
      Object.defineProperty(errorOut, field, {
        value: value[field],
        writable: true,
        enumerable: false,
        configurable: true,
      });
    }
    for (const field of nativeErrorFields) {
      const child = (value as Error & { cause?: unknown; errors?: unknown })[field];
      const childPath = path ? `${path}.${field}` : field;
      if (
        matchesKey(field, childPath, child, options.keys ?? []) ||
        pathMatches(childPath, options.paths ?? [])
      ) {
        if (options.remove) continue;
        Object.defineProperty(errorOut, field, {
          value: options.replacement,
          writable: true,
          enumerable: false,
          configurable: true,
        });
        continue;
      }
      Object.defineProperty(errorOut, field, {
        value: redactValue(child, options, childPath, depth + 1, seen),
        writable: true,
        enumerable: false,
        configurable: true,
      });
    }
    for (const [key, child] of entries) {
      const childPath = path ? `${path}.${key}` : key;
      if (
        matchesKey(key, childPath, child, options.keys ?? []) ||
        pathMatches(childPath, options.paths ?? [])
      ) {
        if (options.remove) continue;
        errorOut[key] = options.replacement;
      } else {
        errorOut[key] = redactValue(child, options, childPath, depth + 1, seen);
      }
    }
    return errorOut;
  }

  if (value instanceof Map) {
    // Maps fell through to Object.entries() (always []), silently dropping
    // contents. Redact string-keyed entries by key and recurse values so a
    // secret in a Map is masked (not dropped) and legitimate Map data survives.
    const mapOut = new Map<unknown, unknown>();
    seen.set(value, mapOut);
    for (const [key, child] of value) {
      if (typeof key === "string") {
        const childPath = path ? `${path}.${key}` : key;
        if (
          matchesKey(key, childPath, child, options.keys ?? []) ||
          pathMatches(childPath, options.paths ?? [])
        ) {
          if (options.remove) continue;
          mapOut.set(key, options.replacement);
          continue;
        }
        mapOut.set(key, redactValue(child, options, childPath, depth + 1, seen));
        continue;
      }
      mapOut.set(key, redactValue(child, options, path, depth + 1, seen));
    }
    return mapOut;
  }

  if (value instanceof Set) {
    const setOut = new Set<unknown>();
    seen.set(value, setOut);
    let index = 0;
    for (const child of value) {
      setOut.add(redactValue(child, options, `${path}[${index}]`, depth + 1, seen));
      index += 1;
    }
    return setOut;
  }

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
