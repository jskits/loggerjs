import {
  ndjsonCodec,
  toLevelValue,
  type Codec,
  type LogEvent,
  type LoggerLevel,
  type Transport,
} from "@loggerjs/core";
import type { WritableLike } from "./internal-types";

export interface StdoutTransportOptions {
  name?: string;
  stream?: WritableLike;
  codec?: Codec<string | Uint8Array>;
  minLevel?: LoggerLevel;
}

function writePayload(stream: WritableLike, payload: string | Uint8Array) {
  stream.write(payload);
}

export function stdoutTransport(options: StdoutTransportOptions = {}): Transport {
  const codec = options.codec ?? ndjsonCodec();
  const stream = options.stream ?? process.stdout;
  return {
    name: options.name ?? "stdout",
    minLevel: options.minLevel,
    log(event: LogEvent) {
      if (options.minLevel !== undefined && event.level < toLevelValue(options.minLevel)) return;
      writePayload(stream, codec.encode(event));
    },
    flush() {
      return new Promise<void>((resolve) => {
        if (typeof (stream as { cork?: () => void }).cork === "function") {
          stream.write("", () => resolve());
        } else {
          resolve();
        }
      });
    },
  };
}

export function stderrTransport(options: Omit<StdoutTransportOptions, "stream"> = {}): Transport {
  return stdoutTransport({ ...options, name: options.name ?? "stderr", stream: process.stderr });
}
