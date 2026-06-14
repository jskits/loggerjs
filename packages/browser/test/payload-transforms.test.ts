import { afterEach, describe, expect, it, vi } from "vitest";
import { applyPayloadTransforms, encodedPayloadToUint8Array } from "@loggerjs/core";
import { browserCompressionPayloadTransform } from "../src";

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it("uses an injected CompressionStream factory when no compressor is provided", async () => {
    const formats: string[] = [];
    const result = await applyPayloadTransforms(
      "browser-log",
      { contentType: "text/plain" },
      browserCompressionPayloadTransform({
        format: "deflate",
        headers: { "x-loggerjs-transform": "stream" },
        streamFactory(format) {
          formats.push(format);
          const chunks: Uint8Array[] = [];
          let flush!: () => void;
          const readable = new ReadableStream<Uint8Array>({
            start(controller) {
              flush = () => {
                for (const chunk of chunks) controller.enqueue(chunk);
                controller.close();
              };
            },
          });
          const writable = new WritableStream<Uint8Array>({
            write(chunk) {
              chunks.push(Uint8Array.from([...chunk, 33]));
            },
            close() {
              flush();
            },
          });
          return { readable, writable } as unknown as CompressionStream;
        },
      }),
    );

    expect(formats).toEqual(["deflate"]);
    expect(result.headers).toMatchObject({
      "content-encoding": "deflate",
      "x-loggerjs-transform": "stream",
    });
    expect(new TextDecoder().decode(encodedPayloadToUint8Array(result.payload))).toBe(
      "browser-log!",
    );
  });

  it("reports a clear error when CompressionStream is unavailable", async () => {
    vi.stubGlobal("CompressionStream", undefined);

    await expect(
      applyPayloadTransforms(
        "browser-log",
        { contentType: "text/plain" },
        browserCompressionPayloadTransform(),
      ),
    ).rejects.toThrow("CompressionStream is not available in this browser");
  });
});
