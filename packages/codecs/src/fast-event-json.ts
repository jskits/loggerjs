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
  type PreparedRecordEncoder,
  type LogEvent,
  type LogRecord,
  type RecordEncoderHints,
  type SafeStringifyOptions,
} from "@loggerjs/core";

/**
 * Without any option set, encode runs on a native `JSON.stringify` fast path: nested
 * `Error` values serialize as `{}` and circular or BigInt payloads trigger a safe
 * re-encode of the whole input (circular refs become "[Circular]", BigInt becomes a
 * string). Setting any {@link SafeStringifyOptions} field opts into the safe encoder
 * everywhere, which also preserves `Error` name/message/stack inside data payloads.
 *
 * `includeId`, `includeSeq`, and `includeLevelName` trim the envelope for
 * lean comparable JSON output; turning `includeId` off also skips id
 * computation entirely on the record path.
 */
export interface FastEventJsonCodecOptions extends SafeStringifyOptions {
  includeContext?: boolean;
  includeData?: boolean;
  includeError?: boolean;
  includeTrace?: boolean;
  includeSource?: boolean;
  includeId?: boolean;
  includeSeq?: boolean;
  includeLevelName?: boolean;
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
    options.includeSource !== false &&
    options.includeId !== false &&
    options.includeSeq !== false &&
    options.includeLevelName !== false
  );
}

function hasFullHeader(options: FastEventJsonCodecOptions): boolean {
  return (
    (options.includeId ?? true) &&
    (options.includeSeq ?? true) &&
    (options.includeLevelName ?? true)
  );
}

// Resolve every `includeX ?? true` toggle once per codec instead of on every
// encode call. Threading these baked booleans through the encoders lets V8 keep
// the hot path monomorphic and removes the per-call option lookups.
interface ResolvedFlags {
  fullHeader: boolean;
  includeId: boolean;
  includeSeq: boolean;
  includeLevelName: boolean;
  includeData: boolean;
  includeError: boolean;
  includeContext: boolean;
  includeTrace: boolean;
  includeSource: boolean;
}

function resolveFlags(options: FastEventJsonCodecOptions): ResolvedFlags {
  return {
    fullHeader: hasFullHeader(options),
    includeId: options.includeId ?? true,
    includeSeq: options.includeSeq ?? true,
    includeLevelName: options.includeLevelName ?? true,
    includeData: options.includeData ?? true,
    includeError: options.includeError ?? true,
    includeContext: options.includeContext ?? true,
    includeTrace: options.includeTrace ?? true,
    includeSource: options.includeSource ?? true,
  };
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

// Data payloads are usually small flat objects of primitives. Writing them
// directly skips the native JSON.stringify call overhead; any nested or
// exotic value bails out so the caller can use the configured stringifier.
function tryFlatObjectJson(value: Record<string, unknown>): string | undefined {
  // Class instances may carry toJSON or accessors; only plain objects take
  // the fast path so behavior matches JSON.stringify.
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) return undefined;
  let output = "{";
  let first = true;
  // Object.keys (not for..in) on purpose: it returns only own enumerable keys,
  // so a polluted Object.prototype cannot leak inherited keys into log output.
  for (const key of Object.keys(value)) {
    const item = value[key];
    let encoded: string;
    switch (typeof item) {
      case "string":
        encoded = asJsonString(item);
        break;
      case "number":
        encoded = Number.isFinite(item) ? String(item) : "null";
        break;
      case "boolean":
        encoded = item ? "true" : "false";
        break;
      case "object":
        if (item !== null) return undefined;
        encoded = "null";
        break;
      case "undefined":
        continue;
      default:
        return undefined;
    }
    output += `${first ? "" : ","}${asJsonString(key)}:${encoded}`;
    first = false;
  }
  return `${output}}`;
}

function appendDataField(
  output: string,
  value: Record<string, unknown> | undefined,
  stringify: JsonStringify,
): string {
  if (value === undefined) return output;
  const flat = tryFlatObjectJson(value);
  if (flat !== undefined) return `${output},"data":${flat}`;
  return appendField(output, "data", value, stringify);
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

interface PreparedRecordFragments {
  category: readonly string[];
  logger: string;
  tags: LogRecord["tags"];
  tagsFragment?: string;
}

function tryPrepareTagsFragment(
  tags: LogRecord["tags"],
  tagsFragment: (tags: NonNullable<LogRecord["tags"]>) => string,
): string | undefined {
  if (tags === null || !Object.isFrozen(tags)) return undefined;
  try {
    return tagsFragment(tags);
  } catch {
    return undefined;
  }
}

function loggerFragmentForRecord(
  record: LogRecord,
  prepared: PreparedRecordFragments | undefined,
): string {
  if (prepared && record.category === prepared.category) return prepared.logger;
  return loggerFragment(record.category);
}

function tagsFragmentForRecord(
  record: LogRecord,
  tagsFragment: (tags: NonNullable<LogRecord["tags"]>) => string,
  prepared: PreparedRecordFragments | undefined,
): string {
  if (record.tags === null) return "";
  if (prepared && record.tags === prepared.tags && prepared.tagsFragment !== undefined) {
    return prepared.tagsFragment;
  }
  return tagsFragment(record.tags);
}

function encodeEvent(
  event: LogEvent,
  flags: ResolvedFlags,
  stringify: JsonStringify,
  tagsFragment: (tags: NonNullable<LogEvent["tags"]>) => string,
): string {
  let output: string;
  if (flags.fullHeader) {
    output = `{"id":${asJsonString(event.id)},"time":${event.time},"seq":${event.seq},"level":${event.level},"levelName":${asJsonString(event.levelName)},"logger":${asJsonString(event.logger)},"message":${asJsonString(event.message)}`;
  } else {
    // Build the header in one template literal: empty conditional fragments cost
    // nothing, and a single concatenation avoids the chain of intermediate
    // strings the previous `+=` sequence allocated per call.
    const idPart = flags.includeId ? `"id":${asJsonString(event.id)},` : "";
    const seqPart = flags.includeSeq ? `,"seq":${event.seq}` : "";
    const levelNamePart = flags.includeLevelName
      ? `,"levelName":${asJsonString(event.levelName)}`
      : "";
    output = `{${idPart}"time":${event.time}${seqPart},"level":${event.level}${levelNamePart},"logger":${asJsonString(event.logger)},"message":${asJsonString(event.message)}`;
  }
  if (event.type !== undefined) output += `,"type":${asJsonString(event.type)}`;
  if (event.tags !== undefined) output += tagsFragment(event.tags);
  if (flags.includeData && event.data !== undefined)
    output = appendField(output, "data", event.data, stringify);
  if (flags.includeError && event.error !== undefined)
    output = appendField(output, "error", event.error, stringify);
  if (flags.includeContext && event.context !== undefined)
    output = appendField(output, "context", event.context, stringify);
  if (flags.includeTrace && event.trace !== undefined)
    output = appendField(output, "trace", event.trace, stringify);
  if (flags.includeSource && event.source !== undefined)
    output = appendField(output, "source", event.source, stringify);
  return `${output}}`;
}

function encodeRecord(
  record: LogRecord,
  flags: ResolvedFlags,
  stringify: JsonStringify,
  tagsFragment: (tags: NonNullable<LogRecord["tags"]>) => string,
  prepared?: PreparedRecordFragments,
): string {
  let output: string;
  if (flags.fullHeader) {
    // The default id only contains [0-9a-z-] and the level name, so it never
    // needs escaping.
    const levelName = toLevelName(record.level);
    output = `{"id":"${defaultRecordId(record, levelName)}${timeFragment(record.time)}${record.seq}${levelFragment(record.level)}${loggerFragmentForRecord(record, prepared)},"message":${asJsonString(resolveMessage(record))}`;
  } else {
    // The header is built in one template literal so it costs a single
    // concatenation per record; empty conditional fragments cost nothing. The
    // level name is resolved only when the id or the levelName field needs it,
    // so the lean envelope (both off) skips the lookup. The "info" default is
    // never emitted in that case — both fragments stay empty.
    const levelName =
      flags.includeId || flags.includeLevelName ? toLevelName(record.level) : "info";
    const idPart = flags.includeId ? `"id":"${defaultRecordId(record, levelName)}",` : "";
    const seqPart = flags.includeSeq ? `,"seq":${record.seq}` : "";
    const levelNamePart = flags.includeLevelName ? `,"levelName":"${levelName}"` : "";
    output = `{${idPart}"time":${record.time}${seqPart},"level":${record.level}${levelNamePart},"logger":${loggerFragmentForRecord(record, prepared)},"message":${asJsonString(resolveMessage(record))}`;
  }
  if (record.type !== null) output += `,"type":${asJsonString(record.type)}`;
  output += tagsFragmentForRecord(record, tagsFragment, prepared);
  // Guard each optional tail on the record field directly so a null field skips
  // the helper call (and its argument evaluation) entirely, matching the prior
  // `?? undefined` no-op behavior without the per-call cost.
  if (flags.includeData && record.props != null)
    output = appendDataField(output, record.props, stringify);
  if (flags.includeError && record.err != null)
    output = appendField(output, "error", errorForRecord(record), stringify);
  if (flags.includeContext && record.ctx != null)
    output = appendField(output, "context", record.ctx, stringify);
  if (flags.includeTrace && record.trace != null)
    output = appendField(output, "trace", record.trace, stringify);
  if (flags.includeSource && record.source !== "app")
    output += `,"source":{"integration":${asJsonString(record.source)}}`;
  return `${output}}`;
}

type TagsFragment = (tags: NonNullable<LogEvent["tags"]>) => string;

function encodeItem(
  item: LogEvent | LogRecord,
  flags: ResolvedFlags,
  stringify: JsonStringify,
  tagsFragment: TagsFragment,
): string {
  return isLogRecord(item)
    ? encodeRecord(item, flags, stringify, tagsFragment)
    : encodeEvent(item, flags, stringify, tagsFragment);
}

function encodeArray(
  items: readonly (LogEvent | LogRecord)[],
  flags: ResolvedFlags,
  stringify: JsonStringify,
  tagsFragment: TagsFragment,
): string {
  let output = "[";
  for (let index = 0; index < items.length; index += 1) {
    if (index > 0) output += ",";
    output += encodeItem(items[index]!, flags, stringify, tagsFragment);
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
  // Bake the envelope toggles once so neither the fast nor the safe encoder
  // re-derives them per call.
  const flags = resolveFlags(options);
  const tagsFragment = createTagsFragment(stringify, true);
  // The fallback must not reuse the fast fragments: a cached entry or the
  // fast stringify could throw on the exact payload that triggered fallback.
  const safeTagsFragment = createTagsFragment(safeStringify, false);
  const fastEncode = (input: CodecInput): string => {
    if (isCodecArray(input)) {
      if (useNativeEventJson && !hasLogRecord(input)) return JSON.stringify(input);
      return encodeArray(input, flags, stringify, tagsFragment);
    }
    // Dispatch the single-item case directly to the concrete encoder, skipping
    // the encodeItem indirection and resolving the record/event branch once.
    if (isLogRecord(input)) return encodeRecord(input, flags, stringify, tagsFragment);
    if (useNativeEventJson) return JSON.stringify(input);
    return encodeEvent(input, flags, stringify, tagsFragment);
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
      if (isCodecArray(input)) return encodeArray(input, flags, safeStringify, safeTagsFragment);
      return encodeItem(input, flags, safeStringify, safeTagsFragment);
    },
    decode(payload) {
      return JSON.parse(payload) as LogEvent | LogEvent[];
    },
    prepareRecordEncoder(hints: RecordEncoderHints): PreparedRecordEncoder<string> {
      const prepared: PreparedRecordFragments = {
        category: hints.category,
        logger: loggerFragment(hints.category),
        tags: hints.tags,
        tagsFragment: tryPrepareTagsFragment(hints.tags, tagsFragment),
      };
      return {
        encode(record: LogRecord) {
          try {
            return encodeRecord(record, flags, stringify, tagsFragment, prepared);
          } catch {
            incrementLoggerMetaCounter("codec.fallback");
            incrementLoggerMetaCounter("codec.fallback.fast-event-json");
          }
          return encodeRecord(record, flags, safeStringify, safeTagsFragment, {
            category: prepared.category,
            logger: prepared.logger,
            tags: prepared.tags,
          });
        },
      };
    },
  };
}
