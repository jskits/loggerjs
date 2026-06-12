import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { applyPayloadTransforms } from "@loggerjs/core";
import { nodeCompressionPayloadTransform } from "../src";

describe("node payload transforms", () => {
  it("compresses payloads with gzip and exposes content-encoding", async () => {
    const result = await applyPayloadTransforms(
      "node-log",
      { contentType: "text/plain" },
      nodeCompressionPayloadTransform(),
    );

    expect(result.headers).toMatchObject({ "content-encoding": "gzip" });
    expect(gunzipSync(result.payload as Uint8Array).toString("utf8")).toBe("node-log");
  });

  it("supports brotli and deflate formats", async () => {
    const brotli = await applyPayloadTransforms(
      "br-log",
      { contentType: "text/plain" },
      nodeCompressionPayloadTransform({ format: "brotli" }),
    );
    const deflate = await applyPayloadTransforms(
      "deflate-log",
      { contentType: "text/plain" },
      nodeCompressionPayloadTransform({ format: "deflate" }),
    );

    expect(brotli.headers).toMatchObject({ "content-encoding": "br" });
    expect(brotliDecompressSync(brotli.payload as Uint8Array).toString("utf8")).toBe("br-log");
    expect(deflate.headers).toMatchObject({ "content-encoding": "deflate" });
    expect(inflateSync(deflate.payload as Uint8Array).toString("utf8")).toBe("deflate-log");
  });
});
