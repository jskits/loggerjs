import type { Codec, LogEvent } from "@loggerjs/core";

export interface ProjectorCodecOptions<TWire> {
  name: string;
  contentType: string;
  project: (input: LogEvent | LogEvent[]) => TWire;
  serialize: (wire: TWire) => string | Uint8Array;
  parse?: (payload: string | Uint8Array) => TWire;
  unproject?: (wire: TWire) => LogEvent | LogEvent[];
}

export function projectorCodec<TWire>(options: ProjectorCodecOptions<TWire>): Codec<string | Uint8Array> {
  return {
    name: options.name,
    contentType: options.contentType,
    encode(input) {
      return options.serialize(options.project(input));
    },
    decode: options.parse && options.unproject
      ? (payload) => options.unproject!(options.parse!(payload))
      : undefined
  };
}
