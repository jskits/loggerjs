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

  it("re-encodes only the poisoned ndjson line through the safe fallback", () => {
    const data: Record<string, unknown> = { orderId: "ord-1" };
    data.self = data;
    const poisoned = createRecord({ time: 1, level: 30, msg: "poison", props: data, seq: 1 });
    const clean = createRecord({ time: 1, level: 30, msg: "clean", seq: 2 });

    const lines = ndjsonCodec()
      .encode([poisoned, clean])
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      message: "poison",
      data: { orderId: "ord-1", self: "[Circular]" },
    });
    expect(lines[1]).toMatchObject({ message: "clean" });
  });

  it("keeps full safe normalization when ndjson safe options are set", () => {
    const record = createRecord({
      time: 1,
      level: 30,
      msg: "created",
      props: { err: new Error("boom"), deep: { a: { b: { c: 1 } } } },
      seq: 1,
    });

    const line = JSON.parse(ndjsonCodec({ maxDepth: 4 }).encode(record).trim()) as Record<
      string,
      unknown
    >;
    expect(line).toMatchObject({
      data: { err: { name: "Error", message: "boom" }, deep: { a: { b: "[MaxDepth]" } } },
    });

    // Default mode matches native JSON semantics for non-throwing input.
    const nativeLine = JSON.parse(ndjsonCodec().encode(record).trim()) as {
      data: { err: unknown };
    };
    expect(nativeLine.data.err).toEqual({});
  });
});
