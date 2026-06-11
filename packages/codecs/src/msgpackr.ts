import { normalizeCodecInput, type Codec, type CodecInput, type LogEvent } from "@loggerjs/core";
import { Packr, type Options as MsgpackrOptions } from "msgpackr";

export interface MsgpackRuntime {
  pack: (input: unknown) => Uint8Array;
  unpack: (payload: Uint8Array) => unknown;
}

export type MsgpackrCodecOptions = MsgpackrOptions;

function isMsgpackRuntime(value: MsgpackRuntime | MsgpackrCodecOptions): value is MsgpackRuntime {
  return (
    typeof (value as MsgpackRuntime).pack === "function" &&
    typeof (value as MsgpackRuntime).unpack === "function"
  );
}

export function msgpackrCodec(
  options: MsgpackRuntime | MsgpackrCodecOptions = {},
): Codec<Uint8Array> {
  const runtime = isMsgpackRuntime(options) ? options : new Packr({ useRecords: true, ...options });
  return {
    name: "msgpackr",
    contentType: "application/msgpack",
    encode(input: CodecInput) {
      return runtime.pack(normalizeCodecInput(input));
    },
    decode(payload: Uint8Array) {
      return runtime.unpack(payload) as LogEvent | LogEvent[];
    },
  };
}
