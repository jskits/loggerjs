import {
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

function sourceForRecord(record: LogRecord): LogEvent["source"] | undefined {
  if (record.source === "app") return undefined;
  return { integration: record.source };
}

function errorForRecord(record: LogRecord): LogEvent["error"] | undefined {
  if (record.err === null || record.err === undefined) return undefined;
  return normalizeError(record.err);
}

function encodeEvent(
  event: LogEvent,
  options: FastEventJsonCodecOptions,
  stringify: JsonStringify,
): string {
  let output = `{"id":${JSON.stringify(event.id)},"time":${event.time},"seq":${event.seq},"level":${event.level},"levelName":${JSON.stringify(event.levelName)},"logger":${JSON.stringify(event.logger)},"message":${JSON.stringify(event.message)}`;
  output = appendField(output, "type", event.type, stringify);
  output = appendField(output, "tags", event.tags, stringify);
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
): string {
  const levelName = toLevelName(record.level);
  const id = `${record.time.toString(36)}-${record.seq.toString(36)}-${levelName}`;
  let output = `{"id":${JSON.stringify(id)},"time":${record.time},"seq":${record.seq},"level":${record.level},"levelName":${JSON.stringify(levelName)},"logger":${JSON.stringify(record.category.join("."))},"message":${JSON.stringify(resolveMessage(record))}`;
  output = appendField(output, "type", record.type ?? undefined, stringify);
  output = appendField(output, "tags", record.tags ?? undefined, stringify);
  if (options.includeData ?? true)
    output = appendField(output, "data", record.props ?? undefined, stringify);
  if (options.includeError ?? true)
    output = appendField(output, "error", errorForRecord(record), stringify);
  if (options.includeContext ?? true)
    output = appendField(output, "context", record.ctx ?? undefined, stringify);
  if (options.includeTrace ?? true)
    output = appendField(output, "trace", record.trace ?? undefined, stringify);
  if (options.includeSource ?? true)
    output = appendField(output, "source", sourceForRecord(record), stringify);
  return `${output}}`;
}

function encodeItem(
  item: LogEvent | LogRecord,
  options: FastEventJsonCodecOptions,
  stringify: JsonStringify,
): string {
  return isLogRecord(item)
    ? encodeRecord(item, options, stringify)
    : encodeEvent(item, options, stringify);
}

function encodeArray(
  items: readonly (LogEvent | LogRecord)[],
  options: FastEventJsonCodecOptions,
  stringify: JsonStringify,
): string {
  let output = "[";
  for (let index = 0; index < items.length; index += 1) {
    if (index > 0) output += ",";
    output += encodeItem(items[index]!, options, stringify);
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

export function fastEventJsonCodec(options: FastEventJsonCodecOptions = {}): Codec<string> {
  const stringify = createStringify(options);
  const useNativeEventJson = canUseNativeEventJson(options);
  return {
    name: "fast-event-json",
    contentType: "application/json",
    encode(input: CodecInput) {
      if (isCodecArray(input)) {
        if (useNativeEventJson && !hasLogRecord(input)) return JSON.stringify(input);
        return encodeArray(input, options, stringify);
      }
      if (useNativeEventJson && !isLogRecord(input)) return JSON.stringify(input);
      return isLogRecord(input)
        ? encodeRecord(input, options, stringify)
        : encodeEvent(input, options, stringify);
    },
    decode(payload) {
      return JSON.parse(payload) as LogEvent | LogEvent[];
    },
  };
}
