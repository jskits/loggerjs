import { existsSync, renameSync, statSync, unlinkSync } from "fs";
import {
  ndjsonCodec,
  toLevelValue,
  type Codec,
  type LogEvent,
  type LoggerLevel,
  type Transport,
} from "@loggerjs/core";
import { createNodeFileDestination } from "./node-destination";

export interface RotatingFileTransportOptions {
  path: string;
  name?: string;
  codec?: Codec<string | Uint8Array>;
  minLevel?: LoggerLevel;
  flags?: string;
  append?: boolean;
  mkdir?: boolean;
  maxBytes?: number;
  maxFiles?: number;
  archivePath?: (path: string, index: number) => string;
}

export interface RotatingFileTransport extends Transport {
  rotate: () => void;
  flushSync: () => void;
  currentBytes: () => number;
}

const textEncoder = new TextEncoder();

function payloadBytes(payload: string | Uint8Array): number {
  return typeof payload === "string" ? textEncoder.encode(payload).byteLength : payload.byteLength;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
}

function defaultArchivePath(path: string, index: number): string {
  return `${path}.${index}`;
}

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

export function rotatingFileTransport(
  options: RotatingFileTransportOptions,
): RotatingFileTransport {
  const codec = options.codec ?? ndjsonCodec();
  const maxBytes = normalizePositiveInteger(options.maxBytes, 10 * 1024 * 1024);
  const maxFiles = normalizeNonNegativeInteger(options.maxFiles, 5);
  const archivePath = options.archivePath ?? defaultArchivePath;
  const destination = createNodeFileDestination({
    name: options.name ?? "rotating-file",
    path: options.path,
    flags: options.flags,
    append: options.append,
    mkdir: options.mkdir,
    sync: true,
  });
  let bytes = fileSize(options.path);

  const rotate = () => {
    destination.releaseSync?.();

    if (maxFiles === 0) {
      if (existsSync(options.path)) unlinkSync(options.path);
      bytes = 0;
      return;
    }

    const oldest = archivePath(options.path, maxFiles);
    if (existsSync(oldest)) unlinkSync(oldest);

    for (let index = maxFiles - 1; index >= 1; index -= 1) {
      const source = archivePath(options.path, index);
      if (existsSync(source)) renameSync(source, archivePath(options.path, index + 1));
    }

    if (existsSync(options.path)) renameSync(options.path, archivePath(options.path, 1));
    bytes = 0;
  };

  const writePayload = (payload: string | Uint8Array) => {
    const size = payloadBytes(payload);
    if (bytes > 0 && bytes + size > maxBytes) rotate();
    destination.write(payload);
    bytes += size;
  };

  const transport: RotatingFileTransport = {
    name: options.name ?? "rotating-file",
    minLevel: options.minLevel,
    log(event: LogEvent) {
      if (options.minLevel !== undefined && event.level < toLevelValue(options.minLevel)) return;
      writePayload(codec.encode(event));
    },
    logBatch(events: LogEvent[]) {
      for (const event of events) {
        if (options.minLevel !== undefined && event.level < toLevelValue(options.minLevel))
          continue;
        writePayload(codec.encode(event));
      }
    },
    flush() {
      return destination.flush();
    },
    flushSync: destination.flushSync,
    close() {
      return destination.close();
    },
    rotate,
    currentBytes: () => bytes,
  };

  return transport;
}
