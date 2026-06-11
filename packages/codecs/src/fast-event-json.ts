import {
  defaultRecordId,
  incrementLoggerMetaCounter,
  isLogRecord,
  normalizeError,
  resolveMessage,
  toLevelName,
  safeJsonStringify,
  type Codec,
  type CodecInput,
  type LogEvent,
  type LogRecord,
  type SafeStringifyOptions,
} from "@loggerjs/core";

/**
 * Without any option set, encode runs on a native `JSON.stringify` fast path: nested
 * `Error` values serialize as `{}` and circular or BigInt payloads trigger a safe
 * re-encode of the whole input (circular refs become "[Circular]", BigInt becomes a
 * string). Setting any {@link SafeStringifyOptions} field opts into the safe encoder
 * everywhere, which also preserves `Error` name/message/stack inside data payloads.
 */
export interface FastEventJsonCodecOptions extends SafeStringifyOptions {
  includeContext?: boolean;
  includeData?: boolean;
  includeError?: boolean;
  includeTrace?: boolean;
  includeSource?: boolean;
}

type JsonStringify = (value: unknown) => string | undefined;

function hasSafeOptions(options: SafeStringifyOptions): boolean {
  return (
    options.maxDepth !== undefined ||
    options.maxArrayLength !== undefined ||
    options.maxObjectKeys !== undefined ||
    options.includeStack !== undefined ||
    options.stable !== undefined ||
    options.space !== undefined
  );
}

function canUseNativeEventJson(options: FastEventJsonCodecOptions): boolean {
  return (
    !hasSafeOptions(options) &&
    options.includeContext !== false &&
    options.includeData !== false &&
    options.includeError !== false &&
    options.includeTrace !== false &&
    options.includeSource !== false
  );
}

function createStringify(options: SafeStringifyOptions): JsonStringify {
  if (hasSafeOptions(options)) return (value) => safeJsonStringify(value, options);
  return JSON.stringify;
}

function appendField(
  output: string,
  name: string,
  value: unknown,
  stringify: JsonStringify,
): string {
  if (value === undefined) return output;
  const encoded = stringify(value);
  return encoded === undefined ? output : `${output},"${name}":${encoded}`;
}

// JSON.stringify costs ~35ns per short string mostly in call overhead. Short
// strings without quotes, backslashes, or control characters can be quoted
// directly after a linear scan.
function asJsonString(value: string): string {
  if (value.length > 256) return JSON.stringify(value);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 34 || code === 92 || code < 32) return JSON.stringify(value);
  }
  return `"${value}"`;
}

// The timestamp changes once per millisecond while bursts of records share
// it, so the rendered `","time":...,"seq":` fragment can be memoized the same
// way the default id memoizes its time segment.
let lastFragmentTime = -1;
let lastTimeFragment = "";

function timeFragment(time: number): string {
  if (time !== lastFragmentTime) {
    lastFragmentTime = time;
    lastTimeFragment = `","time":${time},"seq":`;
  }
  return lastTimeFragment;
}

// level -> ',"level":30,"levelName":"info","logger":' — derived from the
// numeric level alone, so a module-level cache is safe.
const levelFragments = new Map<number, string>();

function levelFragment(level: number): string {
  let fragment = levelFragments.get(level);
  if (fragment === undefined) {
    fragment = `,"level":${level},"levelName":"${toLevelName(level)}","logger":`;
    levelFragments.set(level, fragment);
  }
  return fragment;
}

// Loggers reuse one frozen category array for every record, so the joined and
// escaped logger name can be cached per array identity.
const categoryFragments = new WeakMap<readonly string[], string>();

function loggerFragment(category: readonly string[]): string {
  let fragment = categoryFragments.get(category);
  if (fragment === undefined) {
    fragment = asJsonString(category.join("."));
    categoryFragments.set(category, fragment);
  }
  return fragment;
}

function errorForRecord(record: LogRecord): LogEvent["error"] | undefined {
  if (record.err === null || record.err === undefined) return undefined;
  return normalizeError(record.err);
}

function encodeEvent(
  event: LogEvent,
  options: FastEventJsonCodecOptions,
  stringify: JsonStringify,
  tagsFragment: (tags: NonNullable<LogEvent["tags"]>) => string,
): string {
  let output = `{"id":${asJsonString(event.id)},"time":${event.time},"seq":${event.seq},"level":${event.level},"levelName":${asJsonString(event.levelName)},"logger":${asJsonString(event.logger)},"message":${asJsonString(event.message)}`;
  if (event.type !== undefined) output += `,"type":${asJsonString(event.type)}`;
  if (event.tags !== undefined) output += tagsFragment(event.tags);
  if (options.includeData ?? true) output = appendField(output, "data", event.data, stringify);
  if (options.includeError ?? true) output = appendField(output, "error", event.error, stringify);
  if (options.includeContext ?? true)
    output = appendField(output, "context", event.context, stringify);
  if (options.includeTrace ?? true) output = appendField(output, "trace", event.trace, stringify);
  if (options.includeSource ?? true)
    output = appendField(output, "source", event.source, stringify);
  return `${output}}`;
}

function encodeRecord(
  record: LogRecord,
  options: FastEventJsonCodecOptions,
  stringify: JsonStringify,
  tagsFragment: (tags: NonNullable<LogRecord["tags"]>) => string,
): string {
  const levelName = toLevelName(record.level);
  // The default id only contains [0-9a-z-] and the level name, so it never
  // needs escaping.
  const id = defaultRecordId(record, levelName);
  let output = `{"id":"${id}${timeFragment(record.time)}${record.seq}${levelFragment(record.level)}${loggerFragment(record.category)},"message":${asJsonString(resolveMessage(record))}`;
  if (record.type !== null) output += `,"type":${asJsonString(record.type)}`;
  if (record.tags !== null) output += tagsFragment(record.tags);
  if (options.includeData ?? true)
    output = appendField(output, "data", record.props ?? undefined, stringify);
  if (options.includeError ?? true)
    output = appendField(output, "error", errorForRecord(record), stringify);
  if (options.includeContext ?? true)
    output = appendField(output, "context", record.ctx ?? undefined, stringify);
  if (options.includeTrace ?? true)
    output = appendField(output, "trace", record.trace ?? undefined, stringify);
  if ((options.includeSource ?? true) && record.source !== "app")
    output += `,"source":{"integration":${asJsonString(record.source)}}`;
  return `${output}}`;
}

type TagsFragment = (tags: NonNullable<LogEvent["tags"]>) => string;

function encodeItem(
  item: LogEvent | LogRecord,
  options: FastEventJsonCodecOptions,
  stringify: JsonStringify,
  tagsFragment: TagsFragment,
): string {
  return isLogRecord(item)
    ? encodeRecord(item, options, stringify, tagsFragment)
    : encodeEvent(item, options, stringify, tagsFragment);
}

function encodeArray(
  items: readonly (LogEvent | LogRecord)[],
  options: FastEventJsonCodecOptions,
  stringify: JsonStringify,
  tagsFragment: TagsFragment,
): string {
  let output = "[";
  for (let index = 0; index < items.length; index += 1) {
    if (index > 0) output += ",";
    output += encodeItem(items[index]!, options, stringify, tagsFragment);
  }
  return `${output}]`;
}

function isCodecArray(input: CodecInput): input is readonly (LogEvent | LogRecord)[] {
  return Array.isArray(input);
}

function hasLogRecord(items: readonly (LogEvent | LogRecord)[]): boolean {
  for (const item of items) {
    if (isLogRecord(item)) return true;
  }
  return false;
}

// Loggers share one frozen tags object across records, so the encoded
// fragment can be cached per object identity. Mutable tags objects are
// re-encoded every time. Callers create one fragment encoder per codec
// because it bakes in that codec's stringify options.
function createTagsFragment(encoder: JsonStringify, cached: boolean): TagsFragment {
  const fragments = cached ? new WeakMap<object, string>() : undefined;
  return (tags) => {
    if (fragments && Object.isFrozen(tags)) {
      let fragment = fragments.get(tags);
      if (fragment === undefined) {
        const encoded = encoder(tags);
        fragment = encoded === undefined ? "" : `,"tags":${encoded}`;
        fragments.set(tags, fragment);
      }
      return fragment;
    }
    const encoded = encoder(tags);
    return encoded === undefined ? "" : `,"tags":${encoded}`;
  };
}

export function fastEventJsonCodec(options: FastEventJsonCodecOptions = {}): Codec<string> {
  const stringify = createStringify(options);
  const safeStringify: JsonStringify = (value) => safeJsonStringify(value, options);
  const useNativeEventJson = canUseNativeEventJson(options);
  const tagsFragment = createTagsFragment(stringify, true);
  // The fallback must not reuse the fast fragments: a cached entry or the
  // fast stringify could throw on the exact payload that triggered fallback.
  const safeTagsFragment = createTagsFragment(safeStringify, false);
  const fastEncode = (input: CodecInput): string => {
    if (isCodecArray(input)) {
      if (useNativeEventJson && !hasLogRecord(input)) return JSON.stringify(input);
      return encodeArray(input, options, stringify, tagsFragment);
    }
    if (useNativeEventJson && !isLogRecord(input)) return JSON.stringify(input);
    return encodeItem(input, options, stringify, tagsFragment);
  };
  return {
    name: "fast-event-json",
    contentType: "application/json",
    encode(input: CodecInput) {
      // Circular references and BigInt values throw on the native fast path. Logs
      // must never be lost to encoding, so re-encode the input with the safe
      // stringifier instead of surfacing the error as a transport failure.
      try {
        return fastEncode(input);
      } catch {
        incrementLoggerMetaCounter("codec.fallback");
        incrementLoggerMetaCounter("codec.fallback.fast-event-json");
      }
      if (isCodecArray(input)) return encodeArray(input, options, safeStringify, safeTagsFragment);
      return encodeItem(input, options, safeStringify, safeTagsFragment);
    },
    decode(payload) {
      return JSON.parse(payload) as LogEvent | LogEvent[];
    },
  };
}
