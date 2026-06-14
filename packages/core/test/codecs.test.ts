import { describe, expect, it } from "vitest";
import {
  createPreparedRecordEncoder,
  createRecord,
  jsonCodec,
  metricsCodec,
  ndjsonCodec,
  safeJsonCodec,
  type Codec,
  type LogRecord,
} from "../src";

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

  it("caches prepared record encoders by category and tags identity", () => {
    let prepareCalls = 0;
    const codec: Codec<string> = {
      name: "prepared-test",
      contentType: "text/plain",
      encode(input) {
        return `fallback:${Array.isArray(input) ? input.length : 1}`;
      },
      prepareRecordEncoder(hints) {
        prepareCalls += 1;
        return {
          encode(record: LogRecord) {
            return `${hints.category.join(".")}:${Object.keys(hints.tags ?? {}).join(",")}:${record.seq}`;
          },
        };
      },
    };
    const encode = createPreparedRecordEncoder(codec);
    const sharedTags = Object.freeze({ service: "checkout" });
    const first = createRecord({
      time: 1,
      level: 30,
      category: ["api"],
      tags: sharedTags,
      msg: "one",
      seq: 1,
    });
    const second = { ...first, msg: "two", seq: 2 };
    const third = createRecord({
      time: 1,
      level: 30,
      category: ["api"],
      tags: { service: "checkout" },
      msg: "three",
      seq: 3,
    });

    expect(encode(first)).toBe("api:service:1");
    expect(encode(second)).toBe("api:service:2");
    expect(encode(third)).toBe("api:service:3");
    expect(prepareCalls).toBe(2);
  });

  it("falls back when a codec has no prepared record encoder", () => {
    const codec: Codec<string> = {
      name: "plain",
      contentType: "text/plain",
      encode(input) {
        return Array.isArray(input) ? "batch" : "single";
      },
    };
    const encode = createPreparedRecordEncoder(codec);

    expect(encode(createRecord({ time: 1, level: 30, msg: "one", seq: 1 }))).toBe("single");
  });

  it("keeps prepared encoders through metricsCodec wrappers", () => {
    const codec: Codec<string> = {
      name: "prepared-test",
      contentType: "text/plain",
      encode() {
        return "fallback";
      },
      prepareRecordEncoder() {
        return {
          encode(record) {
            return `prepared:${record.seq}`;
          },
        };
      },
    };
    const encode = createPreparedRecordEncoder(metricsCodec(codec));

    expect(encode(createRecord({ time: 1, level: 30, msg: "one", seq: 1 }))).toBe("prepared:1");
  });

  it("falls back to plain encode when prepareRecordEncoder throws", () => {
    const codec: Codec<string> = {
      name: "prepare-throws",
      contentType: "text/plain",
      encode(input) {
        return `plain:${Array.isArray(input) ? input.length : 1}`;
      },
      prepareRecordEncoder() {
        throw new Error("prepare failed");
      },
    };
    const encode = createPreparedRecordEncoder(codec);

    expect(encode(createRecord({ time: 1, level: 30, msg: "one", seq: 1 }))).toBe("plain:1");
  });
});
