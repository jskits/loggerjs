import {
  incrementLoggerMetaCounter,
  normalizeCodecInput,
  safeJsonStringify,
  type Codec,
  type CodecInput,
  type LogEvent,
  type SafeStringifyOptions,
  type SerializedError,
} from "@loggerjs/core";

export type PinoCompatCollisionPolicy = "nest" | "drop" | "throw";

export interface PinoCompatCodecOptions extends SafeStringifyOptions {
  base?: Record<string, unknown>;
  dataKey?: string;
  errorKey?: string;
  includeLogger?: boolean;
  mergeData?: boolean;
  collision?: PinoCompatCollisionPolicy;
}

const baseReservedRootKeys = new Set(["time", "level", "msg", "err", "logger", "data"]);
const dataReservedRootKeys = new Set([
  "time",
  "level",
  "msg",
  "pid",
  "hostname",
  "err",
  "logger",
  "data",
]);

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pinoError(error: SerializedError): Record<string, unknown> {
  return {
    type: error.name ?? "Error",
    message: error.message,
    stack: error.stack,
    code: error.code,
    cause: error.cause,
  };
}

function assignWithCollision(
  output: Record<string, unknown>,
  nested: Record<string, unknown>,
  key: string,
  value: unknown,
  policy: PinoCompatCollisionPolicy,
  reservedKeys = dataReservedRootKeys,
) {
  if (!reservedKeys.has(key) && !(key in output)) {
    output[key] = value;
    return;
  }

  if (policy === "throw") {
    throw new Error(`pinoCompatCodec cannot merge reserved key "${key}"`);
  }
  if (policy === "nest") nested[key] = value;
}

function mergeNestedData(
  existing: unknown,
  nested: Record<string, unknown>,
): Record<string, unknown> {
  if (isRecord(existing)) return { ...nested, ...existing };
  if (existing !== undefined) return { ...nested, value: existing };
  return nested;
}

function projectEvent(event: LogEvent, options: PinoCompatCodecOptions): Record<string, unknown> {
  const dataKey = options.dataKey ?? "data";
  const errorKey = options.errorKey ?? "err";
  const collision = options.collision ?? "nest";
  const output: Record<string, unknown> = {
    level: event.level,
    time: event.time,
  };
  const nested: Record<string, unknown> = {};

  const baseReservedKeys = new Set(baseReservedRootKeys);
  baseReservedKeys.add(dataKey);
  baseReservedKeys.add(errorKey);
  for (const [key, value] of Object.entries(options.base ?? {})) {
    assignWithCollision(output, nested, key, value, collision, baseReservedKeys);
  }

  if (options.includeLogger) output.logger = event.logger;
  if (event.error) output[errorKey] = pinoError(event.error);

  if (event.data !== undefined) {
    if (options.mergeData && isRecord(event.data)) {
      const dataReservedKeys = new Set(dataReservedRootKeys);
      dataReservedKeys.add(dataKey);
      dataReservedKeys.add(errorKey);
      for (const [key, value] of Object.entries(event.data)) {
        assignWithCollision(output, nested, key, value, collision, dataReservedKeys);
      }
    } else {
      output[dataKey] = event.data;
    }
  }

  if (Object.keys(nested).length > 0) {
    output[dataKey] = mergeNestedData(output[dataKey], nested);
  }

  output.msg = event.message;

  return output;
}

function encodeLine(event: LogEvent, options: PinoCompatCodecOptions, safeMode: boolean): string {
  const projected = projectEvent(event, options);
  if (safeMode) return safeJsonStringify(projected, options);
  try {
    const encoded = JSON.stringify(projected);
    return encoded ?? "{}";
  } catch {
    incrementLoggerMetaCounter("codec.fallback");
    incrementLoggerMetaCounter("codec.fallback.pino-compat");
    return safeJsonStringify(projected, options);
  }
}

function encodeEvents(
  input: LogEvent | LogEvent[],
  options: PinoCompatCodecOptions,
  safeMode: boolean,
): string {
  if (!Array.isArray(input)) return `${encodeLine(input, options, safeMode)}\n`;
  let output = "";
  for (const event of input) output += `${encodeLine(event, options, safeMode)}\n`;
  return output;
}

export function pinoCompatCodec(options: PinoCompatCodecOptions = {}): Codec<string> {
  const safeMode = hasSafeOptions(options);
  return {
    name: "pino-compat",
    contentType: "application/x-ndjson",
    encode(input: CodecInput) {
      return encodeEvents(normalizeCodecInput(input), options, safeMode);
    },
  };
}

export const pinoNdjsonProjector = pinoCompatCodec;
