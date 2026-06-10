import { describe, expect, it } from "vitest";
import { createRecord, jsonCodec, ndjsonCodec, safeJsonCodec } from "../src";

describe("core codecs", () => {
  it("accepts LogRecord batches through the compatibility projection", () => {
    const record = createRecord({
      time: 1,
      level: 30,
      category: ["api"],
      msg: "created",
      props: { orderId: "ord-1" },
      seq: 1,
    });

    expect(JSON.parse(jsonCodec().encode([record]))).toMatchObject([
      {
        time: 1,
        levelName: "info",
        logger: "api",
        message: "created",
        data: { orderId: "ord-1" },
      },
    ]);
    expect(JSON.parse(safeJsonCodec().encode([record]))).toHaveLength(1);
    expect(ndjsonCodec().encode([record])).toContain('"message":"created"');
  });
});
