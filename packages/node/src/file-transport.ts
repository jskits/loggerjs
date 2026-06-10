import { createWriteStream, type WriteStream } from "fs";
import {
  ndjsonCodec,
  toLevelValue,
  type Codec,
  type LogEvent,
  type LoggerLevel,
  type Transport,
} from "@loggerjs/core";

export interface FileTransportOptions {
  path: string;
  name?: string;
  codec?: Codec<string | Uint8Array>;
  minLevel?: LoggerLevel;
  flags?: string;
}

export interface FileTransport extends Transport {
  stream: WriteStream;
}

export function fileTransport(options: FileTransportOptions): FileTransport {
  const codec = options.codec ?? ndjsonCodec();
  const stream = createWriteStream(options.path, { flags: options.flags ?? "a" });
  return {
    name: options.name ?? "file",
    minLevel: options.minLevel,
    stream,
    log(event: LogEvent) {
      if (options.minLevel !== undefined && event.level < toLevelValue(options.minLevel)) return;
      stream.write(codec.encode(event));
    },
    flush() {
      return new Promise<void>((resolve, reject) => {
        stream.write("", (error?: Error | null) => (error ? reject(error) : resolve()));
      });
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        stream.end?.((error?: Error | null) => (error ? reject(error) : resolve()));
      });
    },
  };
}
