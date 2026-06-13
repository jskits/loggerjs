import type { LogEvent, Processor } from "@loggerjs/core";

export type PrivacyGuardMatcher =
  | string
  | RegExp
  | ((key: string, path: string, value: unknown) => boolean);

export type PrivacyGuardTarget = "message" | "data" | "context" | "tags" | "error";

export interface PrivacyPattern {
  name: string;
  pattern: RegExp;
  replacement?: string;
  validate?: (match: string) => boolean;
}

export interface PrivacyGuardOptions {
  targets?: readonly PrivacyGuardTarget[];
  denyKeys?: readonly PrivacyGuardMatcher[];
  allowKeys?: readonly PrivacyGuardMatcher[];
  patterns?: readonly PrivacyPattern[];
  replacement?: string;
  maxDepth?: number;
  maxStringLength?: number;
  truncateSuffix?: string;
  onRedact?: (path: string, reason: string) => void;
}

interface NormalizedPrivacyOptions {
  targets: ReadonlySet<PrivacyGuardTarget>;
  denyKeys: readonly PrivacyGuardMatcher[];
  allowKeys: readonly PrivacyGuardMatcher[];
  patterns: readonly PrivacyPattern[];
  redactDefaultEmailPattern: boolean;
  replacement: string;
  maxDepth: number;
  maxStringLength: number;
  truncateSuffix: string;
  onRedact?: (path: string, reason: string) => void;
}

interface GuardResult {
  value: unknown;
  changed: boolean;
}

const DEFAULT_DENY_KEYS: readonly PrivacyGuardMatcher[] = [
  "password",
  "passwd",
  "secret",
  "token",
  "authorization",
  "cookie",
  "set-cookie",
  "apiKey",
  "api_key",
  /session/i,
];

function digitsOnly(input: string): string {
  return input.replace(/\D/g, "");
}

function passesLuhn(input: string): boolean {
  const digits = digitsOnly(input);
  if (digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let doubleDigit = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let value = digits.charCodeAt(index) - 48;
    if (doubleDigit) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

const DEFAULT_PATTERNS: readonly PrivacyPattern[] = [
  {
    name: "bearer-token",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/g,
  },
  {
    name: "credit-card",
    pattern: /\b(?:\d[ -]*?){13,19}\b/g,
    validate: passesLuhn,
  },
];

function isAsciiAlpha(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isAsciiAlphaNumeric(code: number): boolean {
  return isAsciiAlpha(code) || (code >= 48 && code <= 57);
}

function hasChar(code: number, chars: string): boolean {
  return chars.includes(String.fromCharCode(code));
}

function isEmailLocalChar(code: number): boolean {
  return isAsciiAlphaNumeric(code) || hasChar(code, "._%+-");
}

function isEmailDomainChar(code: number): boolean {
  return isAsciiAlphaNumeric(code) || hasChar(code, "-.");
}

function hasValidEmailDomain(input: string, start: number, end: number): boolean {
  let labelLength = 0;
  let dotCount = 0;
  let tldStart = -1;

  for (let index = start; index < end; index += 1) {
    const code = input.charCodeAt(index);
    if (code === 46) {
      if (labelLength === 0) return false;
      dotCount += 1;
      labelLength = 0;
      tldStart = index + 1;
      continue;
    }
    labelLength += 1;
  }

  if (dotCount === 0 || labelLength === 0 || tldStart < 0 || end - tldStart < 2) return false;
  for (let index = tldStart; index < end; index += 1) {
    if (!isAsciiAlpha(input.charCodeAt(index))) return false;
  }
  return true;
}

function redactEmailAddresses(
  input: string,
  path: string,
  options: NormalizedPrivacyOptions,
): GuardResult {
  let output = "";
  let last = 0;
  let changed = false;
  let index = 0;

  while (index < input.length) {
    const startCode = input.charCodeAt(index);
    if (!isAsciiAlphaNumeric(startCode)) {
      index += 1;
      continue;
    }

    const localStart = index;
    let cursor = index + 1;
    while (cursor < input.length && isEmailLocalChar(input.charCodeAt(cursor))) {
      cursor += 1;
    }

    if (input.charCodeAt(cursor) !== 64) {
      index = cursor + 1;
      continue;
    }

    const domainStart = cursor + 1;
    cursor = domainStart;
    while (cursor < input.length && isEmailDomainChar(input.charCodeAt(cursor))) {
      cursor += 1;
    }

    if (
      domainStart < cursor &&
      hasValidEmailDomain(input, domainStart, cursor) &&
      (cursor >= input.length || !isEmailLocalChar(input.charCodeAt(cursor)))
    ) {
      output += input.slice(last, localStart);
      output += options.replacement;
      options.onRedact?.(path, "email");
      last = cursor;
      changed = true;
      index = cursor;
      continue;
    }

    index = domainStart;
  }

  if (!changed) return { value: input, changed: false };
  return { value: output + input.slice(last), changed: true };
}

function matcherMatches(
  matcher: PrivacyGuardMatcher,
  key: string,
  path: string,
  value: unknown,
): boolean {
  if (typeof matcher === "string") return matcher.toLowerCase() === key.toLowerCase();
  if (matcher instanceof RegExp) {
    matcher.lastIndex = 0;
    return matcher.test(key) || matcher.test(path);
  }
  return matcher(key, path, value);
}

function matchesAny(
  matchers: readonly PrivacyGuardMatcher[],
  key: string,
  path: string,
  value: unknown,
): boolean {
  return matchers.some((matcher) => matcherMatches(matcher, key, path, value));
}

function redact(path: string, reason: string, options: NormalizedPrivacyOptions): string {
  options.onRedact?.(path, reason);
  return options.replacement;
}

function guardString(input: string, path: string, options: NormalizedPrivacyOptions): GuardResult {
  let value = input;
  let changed = false;

  if (value.length > options.maxStringLength) {
    options.onRedact?.(path, "max-string-length");
    value = `${value.slice(0, options.maxStringLength)}${options.truncateSuffix}`;
    changed = true;
  }

  if (options.redactDefaultEmailPattern) {
    const emailResult = redactEmailAddresses(value, path, options);
    value = emailResult.value as string;
    changed ||= emailResult.changed;
  }

  for (const item of options.patterns) {
    item.pattern.lastIndex = 0;
    value = value.replace(item.pattern, (match) => {
      if (item.validate && !item.validate(match)) return match;
      options.onRedact?.(path, item.name);
      changed = true;
      return item.replacement ?? options.replacement;
    });
  }

  if (value.length > options.maxStringLength) {
    options.onRedact?.(path, "max-string-length");
    value = `${value.slice(0, options.maxStringLength)}${options.truncateSuffix}`;
    changed = true;
  }

  return { value, changed: changed || value !== input };
}

function guardValue(
  value: unknown,
  path: string,
  key: string,
  depth: number,
  options: NormalizedPrivacyOptions,
  seen: WeakMap<object, unknown>,
): GuardResult {
  if (
    matchesAny(options.denyKeys, key, path, value) &&
    !matchesAny(options.allowKeys, key, path, value)
  ) {
    return { value: redact(path, "deny-key", options), changed: true };
  }

  if (typeof value === "string") return guardString(value, path, options);
  if (value === null || value === undefined || typeof value !== "object") {
    return { value, changed: false };
  }
  if (depth >= options.maxDepth) {
    return { value: redact(path, "max-depth", options), changed: true };
  }
  if (seen.has(value)) return { value: seen.get(value), changed: true };
  if (value instanceof Date || value instanceof Error) return { value, changed: false };

  if (Array.isArray(value)) {
    const out: unknown[] = [];
    seen.set(value, out);
    let changed = false;
    for (let index = 0; index < value.length; index += 1) {
      const child = guardValue(
        value[index],
        `${path}[${index}]`,
        String(index),
        depth + 1,
        options,
        seen,
      );
      out[index] = child.value;
      changed ||= child.changed;
    }
    return { value: changed ? out : value, changed };
  }

  const input = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  seen.set(value, out);
  let changed = false;
  for (const [childKey, childValue] of Object.entries(input)) {
    const childPath = path ? `${path}.${childKey}` : childKey;
    const child = guardValue(childValue, childPath, childKey, depth + 1, options, seen);
    out[childKey] = child.value;
    changed ||= child.changed;
  }
  return { value: changed ? out : value, changed };
}

function guardField<T>(
  value: T,
  path: string,
  options: NormalizedPrivacyOptions,
): { value: T; changed: boolean } {
  const guarded = guardValue(value, path, path, 0, options, new WeakMap<object, unknown>());
  return { value: guarded.value as T, changed: guarded.changed };
}

function maybeSet<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K],
  changed: boolean,
): T {
  if (!changed) return target;
  return { ...target, [key]: value };
}

export function privacyGuardProcessor(options: PrivacyGuardOptions = {}): Processor {
  const normalized: NormalizedPrivacyOptions = {
    targets: new Set(options.targets ?? ["message", "data", "context", "tags", "error"]),
    denyKeys: options.denyKeys ?? DEFAULT_DENY_KEYS,
    allowKeys: options.allowKeys ?? [],
    patterns: options.patterns ?? DEFAULT_PATTERNS,
    redactDefaultEmailPattern: options.patterns === undefined,
    replacement: options.replacement ?? "[REDACTED]",
    maxDepth: Math.max(0, Math.floor(options.maxDepth ?? 8)),
    maxStringLength: Math.max(1, Math.floor(options.maxStringLength ?? 8_192)),
    truncateSuffix: options.truncateSuffix ?? "...",
    onRedact: options.onRedact,
  };

  return (event) => {
    let next: LogEvent = event;

    if (normalized.targets.has("message")) {
      const result = guardString(event.message, "message", normalized);
      next = maybeSet(next, "message", result.value as string, result.changed);
    }
    if (normalized.targets.has("data")) {
      const result = guardField(event.data, "data", normalized);
      next = maybeSet(next, "data", result.value, result.changed);
    }
    if (normalized.targets.has("context")) {
      const result = guardField(event.context, "context", normalized);
      next = maybeSet(next, "context", result.value, result.changed);
    }
    if (normalized.targets.has("tags")) {
      const result = guardField(event.tags, "tags", normalized);
      next = maybeSet(next, "tags", result.value, result.changed);
    }
    if (normalized.targets.has("error")) {
      const result = guardField(event.error, "error", normalized);
      next = maybeSet(next, "error", result.value, result.changed);
    }

    return next;
  };
}
