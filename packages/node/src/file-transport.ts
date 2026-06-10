import { closeSync, createWriteStream, openSync, writeSync, type WriteStream } from "fs";
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
  flushSync: () => void;
}

export function fileTransport(options: FileTransportOptions): FileTransport {
  const codec = options.codec ?? ndjsonCodec();
  const flags = options.flags ?? "a";
  const stream = createWriteStream(options.path, { flags });
  let syncFd: number | undefined;
  const pending: Array<string | Uint8Array> = [];

  const removePending = (payload: string | Uint8Array) => {
    const index = pending.indexOf(payload);
    if (index >= 0) pending.splice(index, 1);
  };

  const getSyncFd = () => {
    syncFd ??= openSync(options.path, flags);
    return syncFd;
  };

  return {
    name: options.name ?? "file",
    minLevel: options.minLevel,
    stream,
    log(event: LogEvent) {
      if (options.minLevel !== undefined && event.level < toLevelValue(options.minLevel)) return;
      const payload = codec.encode(event);
      pending.push(payload);
      stream.write(payload, (error?: Error | null) => {
        if (!error) removePending(payload);
      });
    },
    flush() {
      return new Promise<void>((resolve, reject) => {
        stream.write("", (error?: Error | null) => {
          if (error) {
            reject(error);
            return;
          }
          pending.splice(0, pending.length);
          resolve();
        });
      });
    },
    flushSync() {
      if (pending.length === 0) return;
      const fd = getSyncFd();
      for (const payload of pending.splice(0)) {
        if (typeof payload === "string") writeSync(fd, payload);
        else writeSync(fd, payload);
      }
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        stream.end?.((error?: Error | null) => {
          if (syncFd !== undefined) {
            closeSync(syncFd);
            syncFd = undefined;
          }
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}
