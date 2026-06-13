import {
  ndjsonCodec,
  toLevelValue,
  type Codec,
  type LogEvent,
  type LoggerLevel,
  type Transport,
} from "@loggerjs/core";
import type { WriteStream } from "fs";
import { createNodeFileDestination } from "./node-destination";

export interface FileTransportOptions {
  path: string;
  name?: string;
  codec?: Codec<string | Uint8Array>;
  minLevel?: LoggerLevel;
  flags?: string;
  append?: boolean;
  mkdir?: boolean;
  sync?: boolean;
  minLength?: number;
}

export interface FileTransport extends Transport {
  stream?: WriteStream;
  flushSync: () => void;
}

export function fileTransport(options: FileTransportOptions): FileTransport {
  const codec = options.codec ?? ndjsonCodec();
  const destination = createNodeFileDestination({
    name: options.name ?? "file",
    path: options.path,
    flags: options.flags,
    append: options.append,
    mkdir: options.mkdir,
    sync: options.sync,
    minLength: options.minLength,
  });

  return {
    name: options.name ?? "file",
    minLevel: options.minLevel,
    stream: destination.stream,
    log(event: LogEvent) {
      if (options.minLevel !== undefined && event.level < toLevelValue(options.minLevel)) return;
      destination.write(codec.encode(event));
    },
    flush: destination.flush,
    flushSync: destination.flushSync,
    close: destination.close,
  };
}
