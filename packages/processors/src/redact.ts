import type { LogEvent, Processor } from "@loggerjs/core";
import { defineHidden, dotPath, hiddenErrorFields } from "./error-fields";

export type RedactMatcher =
  | string
  | symbol
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

function keyName(key: PropertyKey): string {
  if (typeof key === "symbol") return key.description ?? key.toString();
  return String(key);
}

function ownEnumerableEntries(value: object): [PropertyKey, unknown][] {
  return Reflect.ownKeys(value)
    .filter((key) => Object.prototype.propertyIsEnumerable.call(value, key))
    .map((key) => [key, (value as Record<PropertyKey, unknown>)[key]]);
}

function matchesKey(
  key: PropertyKey,
  path: string,
  value: unknown,
  matchers: RedactMatcher[],
): boolean {
  const name = keyName(key);
  return matchers.some((matcher) => {
    if (typeof matcher === "symbol") return matcher === key;
    if (typeof matcher === "string") return matcher.toLowerCase() === name.toLowerCase();
    if (matcher instanceof RegExp) {
      matcher.lastIndex = 0;
      const keyMatches = matcher.test(name);
      matcher.lastIndex = 0;
      return keyMatches || matcher.test(path);
    }
    return matcher(name, path, value);
  });
}

function pathMatches(path: string, paths: string[]): boolean {
  return paths.includes(path);
}

function shouldRedact(
  key: PropertyKey,
  path: string,
  value: unknown,
  options: RedactRuntimeOptions,
): boolean {
  return matchesKey(key, path, value, options.keys ?? []) || pathMatches(path, options.paths ?? []);
}

type RedactRuntimeOptions = Required<Pick<RedactOptions, "replacement" | "remove" | "maxDepth">> &
  Pick<RedactOptions, "keys" | "paths">;

function redactValue(
  value: unknown,
  options: RedactRuntimeOptions,
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
    const entries = ownEnumerableEntries(value);
    const hiddenFields = hiddenErrorFields(value);
    if (entries.length === 0 && hiddenFields.length === 0) return value;

    const errorOut = Object.create(Object.getPrototypeOf(value)) as Record<PropertyKey, unknown>;
    seen.set(value, errorOut);
    // Preserve message/stack as non-enumerable own data properties, read via the
    // getter (robust to V8's lazy `stack` accessor), so default output is
    // unchanged and only the extra enumerable props are redacted.
    defineHidden(errorOut, "message", value.message);
    defineHidden(errorOut, "stack", value.stack);
    for (const field of hiddenFields) {
      const child = (value as Error & { cause?: unknown; errors?: unknown })[field];
      const childPath = dotPath(path, field);
      if (shouldRedact(field, childPath, child, options)) {
        if (options.remove) continue;
        defineHidden(errorOut, field, options.replacement);
        continue;
      }
      defineHidden(errorOut, field, redactValue(child, options, childPath, depth + 1, seen));
    }
    for (const [key, child] of entries) {
      const childPath = dotPath(path, keyName(key));
      if (shouldRedact(key, childPath, child, options)) {
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
      if (typeof key === "string" || typeof key === "symbol") {
        const childPath = dotPath(path, keyName(key));
        if (shouldRedact(key, childPath, child, options)) {
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

  const out: Record<PropertyKey, unknown> = {};
  seen.set(value, out);
  for (const [key, child] of ownEnumerableEntries(value)) {
    const childPath = dotPath(path, keyName(key));
    if (shouldRedact(key, childPath, child, options)) {
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
