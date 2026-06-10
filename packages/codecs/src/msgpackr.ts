import type { Codec, LogEvent } from "@loggerjs/core";

export interface MsgpackRuntime {
  pack: (input: unknown) => Uint8Array;
  unpack: (payload: Uint8Array) => unknown;
}

export function msgpackrCodec(runtime: MsgpackRuntime): Codec<Uint8Array> {
  return {
    name: "msgpackr",
    contentType: "application/msgpack",
    encode(input: LogEvent | LogEvent[]) {
      return runtime.pack(input);
    },
    decode(payload: Uint8Array) {
      return runtime.unpack(payload) as LogEvent | LogEvent[];
    },
  };
}
