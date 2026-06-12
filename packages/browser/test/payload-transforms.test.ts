import { describe, expect, it } from "vitest";
import { applyPayloadTransforms, encodedPayloadToUint8Array } from "@loggerjs/core";
import { browserCompressionPayloadTransform } from "../src";

describe("browser payload transforms", () => {
  it("uses an injected compressor and exposes content-encoding", async () => {
    const result = await applyPayloadTransforms(
      "browser-log",
      { contentType: "text/plain" },
      browserCompressionPayloadTransform({
        compress(payload) {
          return Uint8Array.from(
            payload,
            (_value, index) => payload[payload.length - index - 1] ?? 0,
          );
        },
      }),
    );

    expect(result.headers).toMatchObject({ "content-encoding": "gzip" });
    expect(Array.from(encodedPayloadToUint8Array(result.payload))).toEqual([
      ...new TextEncoder().encode("gol-resworb"),
    ]);
  });

  it("supports deflate content-encoding", async () => {
    const result = await applyPayloadTransforms(
      "browser-log",
      { contentType: "text/plain" },
      browserCompressionPayloadTransform({
        format: "deflate",
        compress: (payload) => payload,
      }),
    );

    expect(result.headers).toMatchObject({ "content-encoding": "deflate" });
    expect(new TextDecoder().decode(encodedPayloadToUint8Array(result.payload))).toBe(
      "browser-log",
    );
  });
});
