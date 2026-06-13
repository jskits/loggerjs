import {
  ndjsonCodec,
  toLevelValue,
  type Codec,
  type LogEvent,
  type LoggerLevel,
  type Transport,
} from "@loggerjs/core";
import type { WritableLike } from "./internal-types";
import { createNodeStreamDestination } from "./node-destination";

export interface StdoutTransportOptions {
  name?: string;
  stream?: WritableLike;
  codec?: Codec<string | Uint8Array>;
  minLevel?: LoggerLevel;
  minLength?: number;
  ignoreEpipe?: boolean;
}

export function stdoutTransport(options: StdoutTransportOptions = {}): Transport {
  const codec = options.codec ?? ndjsonCodec();
  const stream = options.stream ?? process.stdout;
  const transportName = options.name ?? "stdout";
  const destination = createNodeStreamDestination({
    name: transportName,
    stream,
    minLength: options.minLength,
    ignoreEpipe: options.ignoreEpipe ?? true,
  });

  return {
    name: transportName,
    minLevel: options.minLevel,
    log(event: LogEvent, context) {
      if (options.minLevel !== undefined && event.level < toLevelValue(options.minLevel)) return;
      destination.write(codec.encode(event), context);
    },
    flush: destination.flush,
    flushSync: destination.flushSync,
    close: destination.close,
  };
}

export function stderrTransport(options: Omit<StdoutTransportOptions, "stream"> = {}): Transport {
  return stdoutTransport({ ...options, name: options.name ?? "stderr", stream: process.stderr });
}
