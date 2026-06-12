import { describe, expect, it } from "vitest";
import {
  applyPayloadTransforms,
  composePayloadTransforms,
  encodedPayloadToUint8Array,
  encryptionPayloadTransform,
} from "../src";

describe("payload transforms", () => {
  it("composes payload, header, and content-type transforms in order", async () => {
    const result = await applyPayloadTransforms(
      "alpha",
      { contentType: "text/plain", headers: { "x-base": "1" }, transport: "test" },
      [
        (payload) => `${payload}:one`,
        (payload, context) => ({
          payload: `${context.contentType}:${payload}:two`,
          contentType: "application/custom",
          headers: { "x-transform": "2" },
        }),
      ],
    );

    expect(result).toEqual({
      payload: "text/plain:alpha:one:two",
      contentType: "application/custom",
      headers: {
        "x-base": "1",
        "x-transform": "2",
      },
    });
  });

  it("creates reusable composed transforms", async () => {
    const transform = composePayloadTransforms(
      (payload) => `${payload}:a`,
      (payload) => `${payload}:b`,
    );

    const result = await transform("log", { contentType: "text/plain" });

    expect(result).toMatchObject({ payload: "log:a:b" });
  });

  it("adapts encryption hooks to payload transforms", async () => {
    const transform = encryptionPayloadTransform({
      contentType: "application/octet-stream",
      headers: { "x-encrypted": "yes" },
      encrypt(payload) {
        return Uint8Array.from([...payload].toReversed());
      },
    });

    const result = await applyPayloadTransforms("abc", { contentType: "text/plain" }, transform);

    expect(Array.from(encodedPayloadToUint8Array(result.payload))).toEqual([99, 98, 97]);
    expect(result.contentType).toBe("application/octet-stream");
    expect(result.headers).toEqual({ "x-encrypted": "yes" });
  });
});
